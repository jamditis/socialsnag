import { describe, it, expect, vi } from 'vitest';
import {
  statusBucket,
  redactUrls,
  formatTrace,
  createTracer,
  DEBUG_SETTING_KEY,
} from '../src/resolver-debug.js';

describe('statusBucket', () => {
  it('buckets the ordinary ranges', () => {
    expect(statusBucket(200)).toBe('2xx');
    expect(statusBucket(204)).toBe('2xx');
    expect(statusBucket(403)).toBe('4xx');
    expect(statusBucket(404)).toBe('4xx');
    expect(statusBucket(500)).toBe('5xx');
    expect(statusBucket(503)).toBe('5xx');
  });

  it('splits 429 out of 4xx', () => {
    // Rate limiting is the most common cause of an empty resolver and the one case
    // where the advice is "wait", not "log in", so it must not hide inside 4xx.
    expect(statusBucket(429)).toBe('429');
  });

  it('reports a missing or impossible status as network', () => {
    expect(statusBucket(0)).toBe('network');
    expect(statusBucket(undefined)).toBe('network');
    expect(statusBucket(null)).toBe('network');
    expect(statusBucket(NaN)).toBe('network');
    expect(statusBucket('403')).toBe('network');
  });

  it('does not silently mislabel a status it was not designed for', () => {
    expect(statusBucket(302)).toBe('other');
  });
});

describe('redactUrls', () => {
  it('removes a CDN url', () => {
    expect(redactUrls('got https://scontent.cdninstagram.com/v/t51.jpg?oe=1')).toBe(
      'got [url removed]',
    );
  });

  it('removes a protocol-relative url and a bare cdn host', () => {
    expect(redactUrls('//video.twimg.com/x.mp4')).toBe('[url removed]');
    expect(redactUrls('host was scontent.cdninstagram.com')).toBe('host was [url removed]');
  });

  it('leaves ordinary debug text alone', () => {
    expect(redactUrls('carousel with 4 items, shortcode C1a2b3')).toBe(
      'carousel with 4 items, shortcode C1a2b3',
    );
  });
});

describe('formatTrace', () => {
  it('names the platform, the path that ran, and the outcome', () => {
    expect(formatTrace({ platform: 'instagram', path: 'post-api', outcome: 'ok', itemCount: 4 })).toBe(
      'socialsnag[instagram] post-api: ok (4 items)',
    );
  });

  it('includes the status bucket rather than the raw code', () => {
    // The raw code would make the log a per-request trace of someone's browsing;
    // the bucket is what a person debugging actually reasons about.
    expect(
      formatTrace({ platform: 'instagram', path: 'story-api', outcome: 'empty', status: 429, itemCount: 0 }),
    ).toBe('socialsnag[instagram] story-api: empty (429, 0 items)');
  });

  it('singularises a one-item count', () => {
    expect(formatTrace({ platform: 'twitter', path: 'syndication', outcome: 'ok', itemCount: 1 })).toBe(
      'socialsnag[twitter] syndication: ok (1 item)',
    );
  });

  it('never emits a url, even when a caller passes one in detail', () => {
    // The privacy rule as a guardrail rather than a convention: a caller cannot leak
    // a CDN url by mistake, only by deliberately defeating the redaction.
    const line = formatTrace({
      platform: 'instagram',
      path: 'dom',
      outcome: 'ok',
      detail: 'picked https://scontent.cdninstagram.com/v/t51.jpg',
    });
    expect(line).not.toMatch(/cdninstagram|https?:\/\//);
    expect(line).toBe('socialsnag[instagram] dom: ok (picked [url removed])');
  });

  it('degrades to something readable when fields are missing', () => {
    // An empty trace should still say something; a blank line in a debug log is the
    // one thing worse than no log at all.
    expect(formatTrace()).toBe('socialsnag[unknown] unknown: unknown');
  });
});

describe('createTracer', () => {
  const storageWith = (value) => ({
    sync: { get: vi.fn().mockResolvedValue({ [DEBUG_SETTING_KEY]: value }) },
  });

  it('stays silent when the setting is off', async () => {
    const logger = { log: vi.fn() };
    const trace = createTracer({ storage: storageWith(false), logger });
    await expect(trace({ platform: 'instagram', path: 'post-api', outcome: 'ok' })).resolves.toBe(false);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs when the setting is on', async () => {
    const logger = { log: vi.fn() };
    const trace = createTracer({ storage: storageWith(true), logger });
    await expect(trace({ platform: 'instagram', path: 'post-api', outcome: 'ok', itemCount: 2 })).resolves.toBe(true);
    expect(logger.log).toHaveBeenCalledWith('socialsnag[instagram] post-api: ok (2 items)');
  });

  it('defaults to off when the key has never been set', async () => {
    const logger = { log: vi.fn() };
    const storage = { sync: { get: vi.fn().mockResolvedValue({}) } };
    const trace = createTracer({ storage, logger });
    await expect(trace({ platform: 'instagram', path: 'dom', outcome: 'ok' })).resolves.toBe(false);
    expect(logger.log).not.toHaveBeenCalled();
    expect(storage.sync.get).toHaveBeenCalledWith({ [DEBUG_SETTING_KEY]: false });
  });

  it('re-reads the setting on every call so a flip takes effect immediately', async () => {
    // The person flipping the toggle is mid-bug-hunt; caching would make them guess
    // whether it took, or reload the extension to find out.
    const logger = { log: vi.fn() };
    const get = vi
      .fn()
      .mockResolvedValueOnce({ [DEBUG_SETTING_KEY]: false })
      .mockResolvedValueOnce({ [DEBUG_SETTING_KEY]: true });
    const trace = createTracer({ storage: { sync: { get } }, logger });

    await trace({ platform: 'instagram', path: 'dom', outcome: 'ok' });
    await trace({ platform: 'instagram', path: 'dom', outcome: 'ok' });

    expect(get).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it('never lets a storage failure break a download', async () => {
    const logger = { log: vi.fn() };
    const storage = { sync: { get: vi.fn().mockRejectedValue(new Error('storage unavailable')) } };
    const trace = createTracer({ storage, logger });
    await expect(trace({ platform: 'instagram', path: 'post-api', outcome: 'ok' })).resolves.toBe(false);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('no-ops rather than throwing when storage is absent entirely', async () => {
    const trace = createTracer({});
    await expect(trace({ platform: 'instagram', path: 'dom', outcome: 'ok' })).resolves.toBe(false);
  });
});
