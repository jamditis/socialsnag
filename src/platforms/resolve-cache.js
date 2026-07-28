// Session-scoped cache for resolved media URLs.
//
// Re-downloading from the same post re-enters the platform resolve APIs, and that
// repeat traffic is what draws a 429. Caching the resolved result for the length of
// a download burst removes the repeat call without changing what any resolver
// returns on a miss.
//
// chrome.storage.session only, matching the captured-media store in background.js:
// the data dies with the browser session and never reaches chrome.storage.local, so
// the rule that CDN URLs stay out of persisted history is unchanged.

const KEY_PREFIX = 'resolved_';

// Instagram and Twitter CDN URLs are time-signed. An entry that outlives its
// signature hands back a URL that 403s on download, which is a worse outcome than
// the one extra API call this cache exists to avoid, so the TTL is deliberately
// far below any observed signature lifetime rather than as long as it could be.
// Two minutes still covers the repeat-download burst that draws the throttle.
export const RESOLVE_CACHE_TTL_MS = 2 * 60 * 1000;

export function resolveCacheKey(platform, id) {
  return `${KEY_PREFIX}${platform}_${id}`;
}

function sessionArea() {
  return globalThis.chrome?.storage?.session ?? null;
}

/**
 * The cached value for this id, or null on a miss, an expired entry, or any
 * storage failure. A cache must never be the reason a resolve fails, so every
 * error path here falls through to the network rather than propagating.
 */
export async function getResolved(platform, id, { now = Date.now } = {}) {
  const store = sessionArea();
  if (!store || !id) return null;
  const key = resolveCacheKey(platform, id);
  try {
    const { [key]: entry } = await store.get(key);
    if (!entry) return null;
    if (now() >= entry.expires) {
      // Drop it here rather than leaving it for a sweep: session storage has no
      // expiry of its own, and this is the only code that reads the key.
      await store.remove(key);
      return null;
    }
    return entry.value ?? null;
  } catch (e) {
    console.warn('SocialSnag: resolve cache read failed:', e);
    return null;
  }
}

/**
 * Cache one resolved value. Callers store successful resolves only: an error is
 * usually the throttle or an auth wall, and replaying it from cache would keep
 * showing a stale failure after the real cause cleared.
 */
export async function setResolved(
  platform,
  id,
  value,
  { ttlMs = RESOLVE_CACHE_TTL_MS, now = Date.now } = {},
) {
  const store = sessionArea();
  if (!store || !id || !value) return;
  const key = resolveCacheKey(platform, id);
  try {
    await store.set({ [key]: { value, expires: now() + ttlMs } });
  } catch (e) {
    console.warn('SocialSnag: resolve cache write failed:', e);
  }
}

/**
 * Drop every cached resolve. For the case the TTL cannot catch: a signature that
 * expired early, so a cached URL fails to download while its entry still looks
 * fresh. Without this, a retry inside the TTL would replay the same dead URL and
 * fail again, which is worse than the repeat API call the cache exists to avoid.
 *
 * It drops every resolve rather than one key because the download that failed does
 * not carry the id it was resolved from, and threading that through the download
 * path would cost more than the over-eviction does: these entries live two minutes,
 * so the worst case is one extra resolve, the behavior before this cache existed.
 *
 * The prefix filter is load-bearing. Session storage is shared with the captured
 * media store (`captured_<tabId>`) and the pending blob list, and taking the whole
 * area would drop captures the user has not downloaded yet.
 */
export async function clearResolveCache() {
  const store = sessionArea();
  if (!store) return;
  try {
    const all = await store.get(null);
    const keys = Object.keys(all ?? {}).filter((k) => k.startsWith(KEY_PREFIX));
    if (keys.length) await store.remove(keys);
  } catch (e) {
    console.warn('SocialSnag: resolve cache clear failed:', e);
  }
}
