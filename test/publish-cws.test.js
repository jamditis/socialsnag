import { describe, it, expect } from 'vitest';
import { interpretUploadState, interpretPublishState, resolveZipPath } from '../publish-cws.js';

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
  it('defaults to the manifest-version zip', () => {
    expect(resolveZipPath(['--skip-publish'], '1.2.1')).toBe('socialsnag-1.2.1.zip');
  });

  it('uses an explicit .zip argument when given', () => {
    expect(resolveZipPath(['some/build.zip'], '1.2.1')).toBe('some/build.zip');
  });
});
