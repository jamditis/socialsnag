import { describe, it, expect } from 'vitest';
import { interpretUploadState, interpretPublishState, resolveZipPath, resolveItemId } from '../publish-cws.js';

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
