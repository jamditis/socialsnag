import { describe, it, expect, afterEach } from 'vitest';
import {
  getResolved,
  setResolved,
  clearResolveCache,
  resolveCacheKey,
  RESOLVE_CACHE_TTL_MS,
} from '../src/platforms/resolve-cache.js';
import { resolveInstagramPost, resolveInstagramStories, resolveViaApi } from '../src/background.js';
import { mapIgStatusToMessage } from '../src/platforms/instagram-api.js';

// Count every request a resolver makes so a cache hit is proven by the absence of
// a second call, not merely by the returned value looking right.
function countingFetch(spec) {
  let calls = 0;
  installFetch((url) => {
    calls += 1;
    return typeof spec === 'function' ? spec(url) : spec;
  });
  return () => calls;
}

// A two-request story resolve: the account lookup, then the tray itself.
function storyTray(url) {
  if (url.includes('web_profile_info')) return { status: 200, json: { data: { user: { id: '55' } } } };
  return {
    status: 200,
    json: { reels_media: [{ items: [
      { pk: '111', image_versions2: { candidates: [{ url: 'https://cdn.cdninstagram.com/a.jpg', width: 1080, height: 1920 }] } },
      { pk: '222', video_versions: [{ url: 'https://cdn.cdninstagram.com/b.mp4', width: 720 }] },
    ] }] },
  };
}

function igPost(url) {
  return { status: 200, json: { items: [{ image_versions2: { candidates: [{ url, width: 100, height: 100 }] } }] } };
}

describe('resolve cache store', () => {
  afterEach(() => resetFetch());

  it('misses on an unknown id', async () => {
    expect(await getResolved('instagram_post', 'nope')).toBeNull();
  });

  it('round-trips a value', async () => {
    await setResolved('instagram_post', 'ABC', [{ url: 'https://cdn.cdninstagram.com/1.jpg' }]);
    expect(await getResolved('instagram_post', 'ABC')).toEqual([
      { url: 'https://cdn.cdninstagram.com/1.jpg' },
    ]);
  });

  it('treats an expired entry as a miss and drops the key', async () => {
    await setResolved('twitter_video', '99', 'https://video.twimg.com/a.mp4', {
      now: () => 0,
      ttlMs: 1000,
    });
    expect(await getResolved('twitter_video', '99', { now: () => 500 })).toBe(
      'https://video.twimg.com/a.mp4',
    );
    expect(await getResolved('twitter_video', '99', { now: () => 5000 })).toBeNull();
    // Dropped, not merely reported as expired, so it cannot linger for the session.
    const key = resolveCacheKey('twitter_video', '99');
    const stored = await chrome.storage.session.get(key);
    expect(stored[key]).toBeUndefined();
  });

  it('clears on request, for a signature that died before the TTL did', async () => {
    await setResolved('twitter_video', '7', 'https://video.twimg.com/b.mp4');
    await setResolved('instagram_post', 'ABC', [{ url: 'https://cdn.cdninstagram.com/1.jpg' }]);
    await clearResolveCache();
    expect(await getResolved('twitter_video', '7')).toBeNull();
    expect(await getResolved('instagram_post', 'ABC')).toBeNull();
  });

  it('clears only its own keys, leaving the rest of session storage alone', async () => {
    // Session storage is shared with the captured-media store, so a clear that took
    // the whole area would drop captures the user has not downloaded yet. These are
    // the real neighbour keys: `captured_<tabId>` and the pending blob list.
    await chrome.storage.session.set({
      captured_9: [{ url: 'https://cdn.cdninstagram.com/seen.jpg' }],
      pendingBlobRevokes: { 4: 'blob:x' },
    });
    await setResolved('twitter_video', '7', 'https://video.twimg.com/b.mp4');
    await clearResolveCache();
    const rest = await chrome.storage.session.get(null);
    expect(rest.captured_9).toEqual([{ url: 'https://cdn.cdninstagram.com/seen.jpg' }]);
    expect(rest.pendingBlobRevokes).toEqual({ 4: 'blob:x' });
  });

  it('stays well under the signature lifetime it is guarding against', () => {
    // The point of the cache is the repeat-download burst, not long-term reuse. A
    // TTL creeping into hours would start handing back dead signed URLs, which is
    // worse than the extra call this saves.
    expect(RESOLVE_CACHE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('ignores an empty id rather than caching under a bare prefix', async () => {
    await setResolved('instagram_post', '', [{ url: 'https://cdn.cdninstagram.com/x.jpg' }]);
    expect(await getResolved('instagram_post', '')).toBeNull();
  });
});

describe('resolver caching', () => {
  afterEach(() => resetFetch());

  it('serves a repeat Instagram post resolve without a second request', async () => {
    const calls = countingFetch(igPost('https://cdn.cdninstagram.com/1.jpg'));

    const first = await resolveInstagramPost('ABC');
    expect(first.items).toHaveLength(1);
    expect(calls()).toBe(1);

    const second = await resolveInstagramPost('ABC');
    expect(second.items).toEqual(first.items);
    expect(calls()).toBe(1);
  });

  it('re-resolves once the entry has expired', async () => {
    const calls = countingFetch(igPost('https://cdn.cdninstagram.com/1.jpg'));
    await resolveInstagramPost('ABC');
    expect(calls()).toBe(1);

    // Age the entry past its TTL rather than waiting it out.
    const key = resolveCacheKey('instagram_post', 'ABC');
    const { [key]: entry } = await chrome.storage.session.get(key);
    await chrome.storage.session.set({ [key]: { ...entry, expires: Date.now() - 1 } });

    await resolveInstagramPost('ABC');
    expect(calls()).toBe(2);
  });

  it('keys by shortcode, so a different post is its own entry', async () => {
    const calls = countingFetch((url) =>
      igPost(url.includes('x') ? 'https://cdn.cdninstagram.com/x.jpg' : 'https://cdn.cdninstagram.com/1.jpg'),
    );
    await resolveInstagramPost('ABC');
    await resolveInstagramPost('XYZ');
    expect(calls()).toBe(2);
  });

  it('does not cache a failure, so a cleared rate limit resolves normally', async () => {
    let status = 429;
    const calls = countingFetch(() =>
      status === 429 ? { status: 429, json: {} } : igPost('https://cdn.cdninstagram.com/1.jpg'),
    );

    const throttled = await resolveInstagramPost('ABC');
    expect(throttled.error).toBe(mapIgStatusToMessage(429));
    expect(calls()).toBe(1);

    status = 200;
    const recovered = await resolveInstagramPost('ABC');
    expect(recovered.items).toHaveLength(1);
    expect(calls()).toBe(2);
  });

  it('re-resolves after a download failed, instead of replaying a dead URL', async () => {
    const calls = countingFetch(igPost('https://cdn.cdninstagram.com/1.jpg'));
    await resolveInstagramPost('ABC');
    expect(calls()).toBe(1);

    // Chrome fetches the resolved URL itself, so a signature that expired ahead of
    // the TTL reaches the extension only as an interrupted download. Retrying from
    // cache after that would fail again for the whole TTL.
    for (const fn of [...chrome.downloads.onChanged._listeners]) {
      await fn({ id: 77, state: { current: 'interrupted' } });
    }

    await resolveInstagramPost('ABC');
    expect(calls()).toBe(2);
  });

  it('keeps the cache when a download completes', async () => {
    const calls = countingFetch(igPost('https://cdn.cdninstagram.com/1.jpg'));
    await resolveInstagramPost('ABC');
    for (const fn of [...chrome.downloads.onChanged._listeners]) {
      await fn({ id: 78, state: { current: 'complete' } });
    }
    await resolveInstagramPost('ABC');
    expect(calls()).toBe(1);
  });

  it('serves a repeat story resolve without re-deriving the user id', async () => {
    // Stories cost two requests, and the cache is checked before the first of them,
    // so a hit must spend nothing at all rather than saving only the second.
    const calls = countingFetch(storyTray);
    const first = await resolveInstagramStories({ username: 'x', storyId: null });
    expect(first.items).toHaveLength(2);
    expect(calls()).toBe(2);

    const second = await resolveInstagramStories({ username: 'x', storyId: null });
    expect(second.items).toEqual(first.items);
    expect(calls()).toBe(2);
  });

  it('keys the whole tray apart from a single story by the same user', async () => {
    // The key joins username and story id, so these two must not collide: asking
    // for one story after viewing the tray has to return one item, not all of them.
    const calls = countingFetch(storyTray);
    const tray = await resolveInstagramStories({ username: 'x', storyId: null });
    expect(tray.items).toHaveLength(2);
    expect(calls()).toBe(2);

    const single = await resolveInstagramStories({ username: 'x', storyId: '222' });
    expect(single.items).toHaveLength(1);
    expect(single.items[0].url).toBe('https://cdn.cdninstagram.com/b.mp4');
    expect(calls()).toBe(4);
  });

  it('serves a repeat tweet lookup without a second request', async () => {
    const calls = countingFetch({
      status: 200,
      json: {
        mediaDetails: [
          {
            type: 'video',
            video_info: {
              variants: [
                { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/a.mp4' },
              ],
            },
          },
        ],
      },
    });

    const url = 'https://twitter.com/u/status/12345';
    const first = await resolveViaApi('twitter', url);
    expect(first.item.url).toBe('https://video.twimg.com/a.mp4');
    expect(calls()).toBe(1);

    const second = await resolveViaApi('twitter', url);
    expect(second.item.url).toBe('https://video.twimg.com/a.mp4');
    expect(calls()).toBe(1);
  });
});
