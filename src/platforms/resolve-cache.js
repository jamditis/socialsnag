// In-memory cache for resolved media URLs, scoped to the service worker.
//
// Re-downloading from the same post re-enters the platform resolve APIs, and that
// repeat traffic is what draws a 429. Caching the resolved result for the length of
// a download burst removes the repeat call without changing what any resolver
// returns on a miss.
//
// Deliberately a module-scoped Map rather than chrome.storage.session. PRIVACY.md
// enumerates exactly what the extension stores, and its two session-storage entries
// are advanced-mode captures and pending zip cleanup. Putting resolved CDN URLs in
// storage would add an undisclosed third category, and the submitted-link flow
// promises that nothing derived from a submitted URL is written to extension
// storage at all. A Map keeps this cache out of storage entirely, so the disclosed
// model stays accurate and the feature needs no privacy-policy change.
//
// The lifetime that costs us is the service worker's: Chrome tears an idle MV3
// worker down and the cache goes with it. That is acceptable here because the case
// this exists for is a burst of downloads from one post, and the worker is alive
// throughout a burst by definition. A worker restart between bursts just means the
// next resolve is a miss, which is the behavior before this cache existed.

// Instagram and Twitter CDN URLs are time-signed. An entry that outlives its
// signature hands back a URL that 403s on download, which is a worse outcome than
// the one extra API call this cache exists to avoid, so the TTL is deliberately
// far below any observed signature lifetime rather than as long as it could be.
// Two minutes still covers the repeat-download burst that draws the throttle.
export const RESOLVE_CACHE_TTL_MS = 2 * 60 * 1000;

const cache = new Map();

export function resolveCacheKey(platform, id) {
  return `${platform}_${id}`;
}

/**
 * The cached value for this id, or null on a miss or an expired entry.
 */
export function getResolved(platform, id, { now = Date.now } = {}) {
  if (!id) return null;
  const key = resolveCacheKey(platform, id);
  const entry = cache.get(key);
  if (!entry) return null;
  if (now() >= entry.expires) {
    // Drop it here rather than leaving it for a sweep: this is the only code
    // that reads the key, so an expired entry would otherwise sit until the
    // worker dies.
    cache.delete(key);
    return null;
  }
  return entry.value ?? null;
}

/**
 * Cache one resolved value. Callers store successful resolves only: an error is
 * usually the throttle or an auth wall, and replaying it from cache would keep
 * showing a stale failure after the real cause cleared.
 */
export function setResolved(
  platform,
  id,
  value,
  { ttlMs = RESOLVE_CACHE_TTL_MS, now = Date.now } = {},
) {
  if (!id || !value) return;
  cache.set(resolveCacheKey(platform, id), { value, expires: now() + ttlMs });
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
 */
export function clearResolveCache() {
  cache.clear();
}
