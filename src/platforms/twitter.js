// SocialSnag — Twitter/X content script

import { findNearestMedia, findPostContainer, getCapturedMedia, hostMatches } from './common.js';

// A tweet's outer boundary. All three of the old id/video/media lookups kept
// their own copy of this list and had drifted apart, so the same click could
// land inside a container for one check and outside it for the next. The last
// entry is the non-article `data-testid="tweet"` variant, so the `article` field
// findTweetScope returns is not guaranteed to be an <article> element.
export const TWEET_SELECTORS = [
  'article[data-testid="tweet"]',
  'article[role="article"]',
  '[data-testid="tweet"]',
];

// A quoted tweet is not an article of its own: X renders it as a role="link"
// block *inside* the quoting tweet's article, which is what makes the whole quote
// clickable. So walking up from the click reaches the outer article for quoted
// and quoting media alike, and whoever asks "which tweet was this?" gets the
// parent either way. Everything below exists to tell the two apart.
//
// The wrapper is matched on role="link" alone, not div[role="link"][tabindex]: X
// does not always render the quote wrapper with a tabindex, and a quoted tweet
// without one would slip past a tabindex-gated selector and be mis-attributed to
// the outer article. The tabindex is not the discriminator anyway -- the permalink
// is. A link-preview card is also a role="link" block, so this selector alone
// would catch cards too; the /status/ permalink check in insideQuotedTweet is what
// separates them: a quoted tweet carries its own /status/ link, a card points at
// an external URL.
export const QUOTED_TWEET_SELECTORS = [
  'div[role="link"]',
];

// --- Pure functions (exported for testing) ---

export function upgradeImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
      u.searchParams.set('name', 'orig');
      return u.toString();
    }
    if (u.hostname === 'pbs.twimg.com' && u.pathname.includes('/profile_images/')) {
      return url.replace(/_(normal|bigger|mini|200x200|400x400)\./i, '.');
    }
  } catch (e) { /* ignore */ }
  return hostMatches(url, 'twimg.com') ? url : null;
}

export function filterCapturedVideos(captured) {
  return captured
    .filter((c) => c.url.includes('video.twimg.com') && c.url.includes('.mp4'))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// The quoted tweet `node` sits inside, searching up to but not past `article`,
// or null if `node` is in the main tweet. A quoted tweet is a focusable
// role="link" wrapper that carries its own /status/ permalink; the permalink is
// required so a link-preview card, also role="link", is not mistaken for a quote.
// Nodes need only `.matches`, `.querySelector`, and `.parentElement`, so plain
// object stubs exercise it in tests exactly as the real DOM does.
export function insideQuotedTweet(node, article) {
  let el = node;
  while (el && el !== article) {
    const isWrapper = QUOTED_TWEET_SELECTORS.some((selector) => el.matches?.(selector));
    if (isWrapper && el.querySelector?.('a[href*="/status/"]')) return el;
    el = el.parentElement;
  }
  return null;
}

// Resolve which tweet a click belongs to. `article` is the outer tweet; `scope`
// is the tightest tweet that owns the click, which is the quoted tweet when the
// click landed inside one and the article otherwise. Downstream lookups run
// against `scope`, so quoted media is attributed to the quoted tweet and the
// main tweet's own media never picks up the quote's images.
export function findTweetScope(target) {
  const article = findPostContainer(target, TWEET_SELECTORS);
  if (!article) return null;
  const quoted = insideQuotedTweet(target, article);
  return { article, scope: quoted || article, isQuoted: Boolean(quoted) };
}

// The status id owning `scope`. When the scope is the main article its DOM
// still contains the quoted tweet's permalink, so quoted-tweet status links are
// skipped; the first remaining one is the main tweet's. When the scope already
// is the quoted block, its own permalink is the first and only candidate.
export function statusIdInScope({ scope, article, isQuoted }) {
  const links = scope.querySelectorAll?.('a[href*="/status/"]') || [];
  for (const link of links) {
    if (!isQuoted && insideQuotedTweet(link, article)) continue;
    const match = link.href?.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

// True if `scope` contains a playable video. On the main article, a video that
// lives inside the quoted tweet does not count, so a click on the main tweet is
// not hijacked into downloading the quote's video. Every video candidate is
// checked, not just the first: a quoted video can precede the main tweet's own
// video in the DOM, and stopping at the first match would miss the real one.
export function scopeHasVideo({ scope, article, isQuoted }) {
  const videos = [
    ...(scope.querySelectorAll?.('video') || []),
    ...(scope.querySelectorAll?.('[data-testid="videoComponent"]') || []),
  ];
  if (isQuoted) return videos.length > 0;
  return videos.some((video) => !insideQuotedTweet(video, article));
}

// True if `img` belongs to `scope`: inside the quoted block for a quoted scope,
// or outside every quoted block for the main scope. The resolveAll sweep only
// passes media it pulled from scope.querySelectorAll, which is always contained,
// so the check is a no-op there. The nearest-media fallback is the caller that
// needs it: findNearestMedia climbs to the shared article and can hand back the
// PARENT tweet's media for a click inside a text-only quote, and an unconditional
// true for quoted scopes would download that parent image as tweet_<quoteId>.
// Checking containment both ways keeps media attributed to the tweet it lives in.
export function imageInScope(img, { article, isQuoted }) {
  const inQuoted = Boolean(insideQuotedTweet(img, article));
  return isQuoted ? inQuoted : !inQuoted;
}

// --- Browser wiring ---
// tweetIdFor/targetHasVideo stay internal; resolveSingle and resolveAll are
// exported so tests can prove their mutual recursion has a base case (see the
// allowFallback note below) from both entry points, without standing up a full DOM.

// The tweet id owning the click, scoped to the quoted tweet when the click is
// inside one. Null off any tweet.
function tweetIdFor(target) {
  const found = findTweetScope(target);
  return found ? statusIdInScope(found) : null;
}

// Whether the clicked tweet — the quoted one, if that is what was clicked — has
// its own video.
function targetHasVideo(target) {
  const found = findTweetScope(target);
  return found ? scopeHasVideo(found) : false;
}

// `allowFallback` guards the one edge of the resolveSingle <-> resolveAll
// recursion that can loop: resolveAll calls this as its empty-sweep fallback, and
// this function's own last resort calls resolveAll back. A scoped sweep that comes
// back empty (a main tweet whose only images belong to a quoted tweet, now that
// imageInScope filters them out) would otherwise re-enter resolveAll forever. When
// resolveAll is the caller it passes allowFallback:false, so the last resort
// returns a terminal empty result instead of recursing. Every other terminating
// path (video detection, nearest-media) still runs, so this only cuts the loop.
export function resolveSingle(srcUrl, target, { allowFallback = true } = {}) {
  // Check if this tweet contains a video — if so, prioritize video download
  // (Twitter blocks right-click on videos, so users right-click the tweet text instead)
  if (targetHasVideo(target)) {
    // If srcUrl is just a profile pic or empty, go straight to video
    const isProfilePic = srcUrl && srcUrl.includes('/profile_images/');
    const isMediaImage = srcUrl && srcUrl.includes('/media/');
    if (!isMediaImage || isProfilePic || !srcUrl) {
      return resolveVideo(target);
    }
  }

  // Try the srcUrl from context menu first (works when right-clicking directly on img)
  const url = upgradeImageUrl(srcUrl);
  if (url) {
    const id = tweetIdFor(target);
    return [{ url, type: 'image', filename: id ? `tweet_${id}` : null }];
  }

  // If click landed on an overlay div, find the nearest media element
  const nearestMedia = findNearestMedia(target);
  if (nearestMedia) {
    // findNearestMedia climbs to the shared article, so it can hand back media that
    // belongs to a quoted tweet the click is not inside -- a quoted photo, or a quoted
    // video when the main tweet has none of its own. imageInScope is a DOM-position
    // check (is this node inside a quoted block?), so it gates a <video> exactly as an
    // <img>: keep the nearest media only when it belongs to the clicked tweet's own
    // scope. Without this gate both branches resolve the quote's media as the main
    // tweet's -- the same leak the resolveAll sweep already filters out.
    const found = findTweetScope(target);
    const inOwnScope = !found || imageInScope(nearestMedia, found);
    if (inOwnScope) {
      if (nearestMedia.tagName === 'IMG') {
        const upgraded = upgradeImageUrl(nearestMedia.src);
        // Don't return a profile pic if the tweet has a video
        if (upgraded && (!targetHasVideo(target) || !upgraded.includes('/profile_images/'))) {
          const id = tweetIdFor(target);
          return [{ url: upgraded, type: 'image', filename: id ? `tweet_${id}` : null }];
        }
      }
      if (nearestMedia.tagName === 'VIDEO' || nearestMedia.closest?.('[data-testid="videoComponent"]')) {
        return resolveVideo(target);
      }
    }
  }

  if (target?.tagName === 'VIDEO' || target?.closest('video') || target?.closest('[data-testid="videoComponent"]')) {
    return resolveVideo(target);
  }

  // Last resort: try to find any media in the parent tweet. Skipped when
  // resolveAll is the caller, so a scoped-empty sweep terminates here instead of
  // re-entering resolveAll and looping.
  return allowFallback ? resolveAll(target) : [];
}

export function resolveAll(target) {
  const found = findTweetScope(target);
  // Off any tweet: let resolveSingle try the click target itself, but with the
  // guard off so its last resort does not bounce back here and loop.
  if (!found) return resolveSingle(target?.src || '', target, { allowFallback: false });

  const items = [];
  const id = statusIdInScope(found);
  let index = 1;

  found.scope.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
    if (!imageInScope(img, found)) return;
    const url = upgradeImageUrl(img.src);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: id ? `tweet_${id}_${index}` : null,
      });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target, { allowFallback: false });
}

async function resolveVideo(target) {
  // First try webRequest captures (advanced mode)
  const captured = await getCapturedMedia();
  const mp4s = filterCapturedVideos(captured);

  if (mp4s.length > 0) {
    return [{ url: mp4s[0].url, type: 'video', filename: null }];
  }

  // Fall back to API lookup via background script
  const tweetId = tweetIdFor(target) || window.location.pathname.match(/\/status\/(\d+)/)?.[1];
  if (tweetId) {
    return [{ type: 'video', filename: `tweet_${tweetId}`, tweetId, needsVideoLookup: true }];
  }

  return [];
}

function initContentScript() {
  let _lastTarget = null;

  // Track right-click target
  document.addEventListener('contextmenu', (e) => {
    _lastTarget = e.target;
  }, true);

  // Listen for resolve requests from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      const target = _lastTarget;

      Promise.resolve()
        .then(() => (message.type === 'single'
          ? resolveSingle(message.srcUrl, target)
          : resolveAll(target)))
        .then((urls) => {
          sendResponse({ urls: urls || [], platform: 'twitter' });
        })
        .catch((err) => {
          console.error('SocialSnag twitter error:', err);
          sendResponse({ urls: [], platform: 'twitter' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
