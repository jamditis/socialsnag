import { describe, it, expect } from 'vitest';
import {
  interpretUploadState,
  interpretUploadStatus,
  backoffDelayMs,
  isRetryableStatusError,
  pollUntilSettled,
  interpretPublishState,
  resolveZipPath,
  resolveItemId,
} from '../publish-cws.js';

describe('interpretUploadState', () => {
  it('treats SUCCEEDED as ok', () => {
    expect(interpretUploadState({ uploadState: 'SUCCEEDED' })).toMatchObject({ ok: true, inProgress: false });
  });

  it('does not treat the v1 spelling SUCCESS as ok', () => {
    // v2 reports SUCCEEDED. Guarding against a v1/v2 regression: the old
    // spelling must never read as success or the script publishes nothing.
    expect(interpretUploadState({ uploadState: 'SUCCESS' }).ok).toBe(false);
  });

  it('flags IN_PROGRESS (both spellings) as still processing', () => {
    expect(interpretUploadState({ uploadState: 'IN_PROGRESS' })).toMatchObject({ ok: false, inProgress: true });
    expect(interpretUploadState({ uploadState: 'UPLOAD_IN_PROGRESS' }).inProgress).toBe(true);
  });

  it('surfaces itemError detail on failure', () => {
    const r = interpretUploadState({ uploadState: 'FAILED', itemError: [{ error_detail: 'version already exists' }] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('version already exists');
  });

  it('reports the raw state when there is no error detail', () => {
    expect(interpretUploadState({ uploadState: 'NOT_FOUND' }).message).toContain('NOT_FOUND');
  });
});

describe('interpretUploadStatus', () => {
  // :fetchStatus reports the async result in lastAsyncUploadState, not uploadState.
  // These guard the field-name mapping: reading uploadState here would always miss.
  it('reads the settled state from lastAsyncUploadState', () => {
    expect(interpretUploadStatus({ lastAsyncUploadState: 'SUCCEEDED' })).toMatchObject({ ok: true, inProgress: false });
  });

  it('flags UPLOAD_IN_PROGRESS from lastAsyncUploadState as still processing', () => {
    expect(interpretUploadStatus({ lastAsyncUploadState: 'UPLOAD_IN_PROGRESS' }).inProgress).toBe(true);
  });

  it('treats FAILED from lastAsyncUploadState as a non-progressing failure', () => {
    const r = interpretUploadStatus({ lastAsyncUploadState: 'FAILED' });
    expect(r).toMatchObject({ ok: false, inProgress: false });
    expect(r.message).toContain('FAILED');
  });

  it('does not read the upload response field uploadState by mistake', () => {
    // A fetchStatus payload carrying only uploadState (wrong field) must not read
    // as success; it would if the helper looked at uploadState instead of
    // lastAsyncUploadState. Absent lastAsyncUploadState reads as unknown, not ok.
    const r = interpretUploadStatus({ uploadState: 'SUCCEEDED' });
    expect(r.ok).toBe(false);
    expect(r.inProgress).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('doubles each attempt from the base delay', () => {
    expect(backoffDelayMs(0, 2000, 20000)).toBe(2000);
    expect(backoffDelayMs(1, 2000, 20000)).toBe(4000);
    expect(backoffDelayMs(2, 2000, 20000)).toBe(8000);
  });

  it('caps the delay at maxDelayMs', () => {
    // Without the cap, attempt 5 would be 64000ms. Bounded backoff must never
    // exceed the ceiling, however many attempts have elapsed.
    expect(backoffDelayMs(5, 2000, 20000)).toBe(20000);
    expect(backoffDelayMs(20, 2000, 20000)).toBe(20000);
  });
});

describe('isRetryableStatusError', () => {
  it('retries a 429 and any 5xx (the store is busy, the upload may still settle)', () => {
    expect(isRetryableStatusError({ status: 429 })).toBe(true);
    expect(isRetryableStatusError({ status: 500 })).toBe(true);
    expect(isRetryableStatusError({ status: 503 })).toBe(true);
  });

  it('does not retry a terminal 4xx (revoked token, permissions, bad item id)', () => {
    // Retrying these just delays the real, actionable error behind the poll budget.
    expect(isRetryableStatusError({ status: 401 })).toBe(false);
    expect(isRetryableStatusError({ status: 403 })).toBe(false);
    expect(isRetryableStatusError({ status: 404 })).toBe(false);
  });

  it('retries a network-level failure that carries no HTTP status', () => {
    // fetch rejecting (connection reset, DNS) is the most transient case of all.
    expect(isRetryableStatusError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableStatusError(undefined)).toBe(true);
  });
});

describe('pollUntilSettled', () => {
  // A fake sleep records what the loop would have waited without a real clock, so
  // the backoff schedule and termination are asserted directly.
  const recordingSleep = () => {
    const waits = [];
    return { waits, sleep: async (ms) => { waits.push(ms); } };
  };
  const deps = (sleep, extra = {}) => ({ attempts: 8, baseDelayMs: 2000, maxDelayMs: 20000, sleep, ...extra });

  it('returns the settled status once the upload succeeds', async () => {
    const { waits, sleep } = recordingSleep();
    let calls = 0;
    // in-progress twice, then SUCCEEDED
    const getStatus = async () => (++calls < 3 ? { ok: false, inProgress: true } : { ok: true, inProgress: false });
    const result = await pollUntilSettled(getStatus, deps(sleep));
    expect(result).toMatchObject({ ok: true, inProgress: false });
    expect(calls).toBe(3);
    // three polls, so three backoff waits following the doubling schedule
    expect(waits).toEqual([2000, 4000, 8000]);
  });

  it('stops at the first non-progressing failure without exhausting the budget', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const getStatus = async () => { calls++; return { ok: false, inProgress: false, message: 'FAILED' }; };
    const result = await pollUntilSettled(getStatus, deps(sleep));
    expect(result).toMatchObject({ ok: false, inProgress: false, message: 'FAILED' });
    expect(calls).toBe(1);
  });

  it('gives up after the attempt budget and reports the timeout', async () => {
    const { waits, sleep } = recordingSleep();
    let calls = 0;
    const getStatus = async () => { calls++; return { ok: false, inProgress: true }; };
    const result = await pollUntilSettled(getStatus, deps(sleep, { attempts: 3 }));
    expect(calls).toBe(3);
    expect(waits).toHaveLength(3);
    expect(result.inProgress).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/3 status checks/);
  });

  it('reports progress via onWait for each retry but not after settling', async () => {
    const { sleep } = recordingSleep();
    const seen = [];
    let calls = 0;
    const getStatus = async () => (++calls < 2 ? { ok: false, inProgress: true } : { ok: true, inProgress: false });
    await pollUntilSettled(getStatus, deps(sleep, { onWait: (ms) => seen.push(ms) }));
    // one in-progress poll before success -> onWait fired once, for the cumulative wait
    expect(seen).toEqual([2000]);
  });

  it('follows the bounded backoff schedule to the cap over the full budget', async () => {
    const { waits, sleep } = recordingSleep();
    const getStatus = async () => ({ ok: false, inProgress: true }); // never settles
    const result = await pollUntilSettled(getStatus, deps(sleep)); // attempts: 8
    // doubling from 2000, then held at the 20000 cap. Proves the cap is
    // load-bearing inside the real loop (not just in backoffDelayMs), and that
    // the schedule sums to the ~2m the publish flow's comment promises.
    expect(waits).toEqual([2000, 4000, 8000, 16000, 20000, 20000, 20000, 20000]);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(110000);
    expect(result.inProgress).toBe(true);
  });

  it('keeps polling through a transient status-check failure and then settles', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const getStatus = async () => {
      calls++;
      if (calls === 1) throw new Error('503 from fetchStatus');
      return { ok: true, inProgress: false };
    };
    const result = await pollUntilSettled(getStatus, deps(sleep));
    // a single blip while the store is still processing must not abort a publish
    // whose upload is fine: the loop absorbs it and reaches the settled success.
    expect(result).toMatchObject({ ok: true, inProgress: false });
    expect(calls).toBe(2);
  });

  it('reports the last status-check error when the budget ends on failures', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const getStatus = async () => { calls++; throw new Error(`503 attempt ${calls}`); };
    const result = await pollUntilSettled(getStatus, deps(sleep, { attempts: 3 }));
    expect(calls).toBe(3);
    expect(result.inProgress).toBe(true);
    expect(result.message).toContain('the last status check failed');
    expect(result.message).toContain('503 attempt 3'); // the most recent error, not an earlier one
  });

  it('does not leak an earlier transient error once a later check succeeds', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    // error on the first check, then clean in-progress for the rest of the budget
    const getStatus = async () => {
      calls++;
      if (calls === 1) throw new Error('transient blip');
      return { ok: false, inProgress: true };
    };
    const result = await pollUntilSettled(getStatus, deps(sleep, { attempts: 3 }));
    expect(result.inProgress).toBe(true);
    // the trailing checks were clean in-progress, so this is a genuine timeout, not
    // a status-check failure. The cleared earlier blip must not leak into the message.
    expect(result.message).not.toContain('the last status check failed');
    expect(result.message).toContain('Re-run');
  });

  it('re-throws a terminal (non-retryable) status error without exhausting the budget', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    const err = Object.assign(new Error('status request failed (401)'), { status: 401 });
    const getStatus = async () => { calls++; throw err; };
    await expect(
      pollUntilSettled(getStatus, deps(sleep, { isRetryable: isRetryableStatusError })),
    ).rejects.toThrow(/401/);
    // failed fast on the first check: no retry loop, no ~2m wait masking the cause
    expect(calls).toBe(1);
  });
});

describe('interpretPublishState', () => {
  it('treats the known success states as ok', () => {
    for (const state of ['PENDING_REVIEW', 'PUBLISHED', 'STAGED', 'PUBLISHED_TO_TESTERS']) {
      expect(interpretPublishState({ state }).ok).toBe(true);
    }
  });

  it('treats REJECTED and CANCELLED as failures', () => {
    expect(interpretPublishState({ state: 'REJECTED' }).ok).toBe(false);
    expect(interpretPublishState({ state: 'CANCELLED' }).ok).toBe(false);
  });

  it('does not report success for an empty or unrecognized response', () => {
    // Fail safe: an empty body or a new/unknown state must not read as a
    // confirmed publish, or the script claims a release that never happened.
    expect(interpretPublishState({}).ok).toBe(false);
    expect(interpretPublishState({ state: 'SOME_FUTURE_STATE' }).ok).toBe(false);
  });

  it('collects publish warnings', () => {
    const r = interpretPublishState({
      state: 'PENDING_REVIEW',
      warningInfo: { warnings: [{ warningDetail: 'listing incomplete' }] },
    });
    expect(r.warnings).toContain('listing incomplete');
  });
});

describe('resolveZipPath', () => {
  it('defaults to the <name>-<version> zip from package.json', () => {
    expect(resolveZipPath(['--skip-publish'], 'socialsnag', '1.2.1')).toBe('socialsnag-1.2.1.zip');
  });

  it('derives the prefix from the package name so it is not repo-specific', () => {
    // Portability: copied into another extension repo, the default zip name
    // follows that repo's package.json "name", not a hardcoded "socialsnag".
    expect(resolveZipPath(['--skip-publish'], 'linksweepr', '2.0.0')).toBe('linksweepr-2.0.0.zip');
  });

  it('uses an explicit .zip argument when given', () => {
    expect(resolveZipPath(['some/build.zip'], 'socialsnag', '1.2.1')).toBe('some/build.zip');
  });
});

describe('resolveItemId', () => {
  it('uses package.json cws.itemId when no env override is set', () => {
    expect(resolveItemId(undefined, { cws: { itemId: 'abc123' } })).toBe('abc123');
  });

  it('lets CWS_ITEM_ID override the package.json value', () => {
    // env beats config so a one-off can target a different listing without
    // editing package.json.
    expect(resolveItemId('envid', { cws: { itemId: 'pkgid' } })).toBe('envid');
  });

  it('throws when neither source provides an id', () => {
    // No hardcoded fallback on purpose: guessing would risk publishing one
    // repo's build to another extension. Missing config must fail loudly.
    expect(() => resolveItemId(undefined, {})).toThrow(/item id/);
    expect(() => resolveItemId('', { cws: {} })).toThrow(/item id/);
  });
});
