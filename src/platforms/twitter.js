// SocialSnag — Twitter/X content script

import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

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
  return url.includes('twimg.com') ? url : null;
}

export function filterCapturedVideos(captured) {
  return captured
    .filter((c) => c.url.includes('video.twimg.com') && c.url.includes('.mp4'))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// --- Browser wiring (not exported) ---

function extractTweetId(target) {
  const tweet = findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
  ]);
  if (!tweet) return null;

  const link = tweet.querySelector('a[href*="/status/"]');
  if (link) {
    const match = link.href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

function tweetHasVideo(target) {
  const tweet = findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
  ]);
  if (!tweet) return false;
  return tweet.querySelector('video') || tweet.querySelector('[data-testid="videoComponent"]');
}

function resolveSingle(srcUrl, target) {
  // Check if this tweet contains a video — if so, prioritize video download
  // (Twitter blocks right-click on videos, so users right-click the tweet text instead)
  if (tweetHasVideo(target)) {
    const id = extractTweetId(target);
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
    const id = extractTweetId(target);
    return [{ url, type: 'image', filename: id ? `tweet_${id}` : null }];
  }

  // If click landed on an overlay div, find the nearest media element
  const nearestMedia = findNearestMedia(target);
  if (nearestMedia) {
    if (nearestMedia.tagName === 'IMG') {
      const upgraded = upgradeImageUrl(nearestMedia.src);
      if (upgraded) {
        // Don't return a profile pic if the tweet has a video
        if (!upgraded.includes('/profile_images/')) {
          const id = extractTweetId(target);
          return [{ url: upgraded, type: 'image', filename: id ? `tweet_${id}` : null }];
        }
      }
    }
    if (nearestMedia.tagName === 'VIDEO' || nearestMedia.closest?.('[data-testid="videoComponent"]')) {
      return resolveVideo(target);
    }
  }

  if (target?.tagName === 'VIDEO' || target?.closest('video') || target?.closest('[data-testid="videoComponent"]')) {
    return resolveVideo(target);
  }

  // Last resort: try to find any media in the parent tweet
  return resolveAll(target);
}

function resolveAll(target) {
  const tweet = findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    '[data-testid="tweet"]',
  ]);
  if (!tweet) return resolveSingle(target?.src || '', target);

  const items = [];
  const id = extractTweetId(target);
  let index = 1;

  tweet.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
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

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

async function resolveVideo(target) {
  // First try webRequest captures (advanced mode)
  const captured = await getCapturedMedia();
  const mp4s = filterCapturedVideos(captured);

  if (mp4s.length > 0) {
    return [{ url: mp4s[0].url, type: 'video', filename: null }];
  }

  // Fall back to API lookup via background script
  const tweetId = extractTweetId(target) || window.location.pathname.match(/\/status\/(\d+)/)?.[1];
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

      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, target)
        : resolveAll(target);

      Promise.resolve(handler)
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
