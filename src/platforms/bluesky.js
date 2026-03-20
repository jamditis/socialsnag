// SocialSnag — Bluesky content script

import { findNearestMedia, findPostContainer } from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeImageUrl(url) {
  if (!url) return null;
  if (!url.includes('cdn.bsky.app')) return null;

  // Upgrade feed_thumbnail to feed_fullsize
  if (url.includes('/feed_thumbnail/')) {
    return url.replace('/feed_thumbnail/', '/feed_fullsize/');
  }

  // Upgrade avatar_thumbnail to avatar
  if (url.includes('/avatar_thumbnail/')) {
    return url.replace('/avatar_thumbnail/', '/avatar/');
  }

  // Already full size or other cdn.bsky.app URL — return as-is
  return url;
}

export function extractPostId(pathname) {
  if (!pathname) return null;
  const match = pathname.match(/\/profile\/[^/]+\/post\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

// --- Browser wiring (not exported) ---

function resolveSingle(srcUrl, target, pathname) {
  const url = upgradeImageUrl(srcUrl);
  if (url) {
    const rkey = extractPostId(pathname);
    return [{ url, type: 'image', filename: rkey ? `post_${rkey}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeImageUrl(nearest.src);
    if (upgraded) {
      const rkey = extractPostId(pathname);
      return [{ url: upgraded, type: 'image', filename: rkey ? `post_${rkey}` : null }];
    }
  }

  // Check for video element
  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      const rkey = extractPostId(pathname);
      return [{ url: src, type: 'video', filename: rkey ? `post_${rkey}` : null }];
    }
  }

  // Fall back to resolveAll
  return [];
}

function resolveAll(target, pathname) {
  const post = findPostContainer(target, [
    '[data-testid^="postThreadItem-by-"]',
    '[data-testid^="feedItem-by-"]',
    '[data-testid^="postThreadItem"]',
    '[data-testid^="feedItem"]',
  ]);
  if (!post) return resolveSingle(target?.src || '', target, pathname);

  const items = [];
  const rkey = extractPostId(pathname);
  let index = 1;

  // Collect images from CDN
  post.querySelectorAll('img[src*="cdn.bsky.app"]').forEach((img) => {
    const url = upgradeImageUrl(img.src);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: rkey ? `post_${rkey}_${index}` : null,
      });
      index++;
    }
  });

  // Collect video elements
  post.querySelectorAll('video').forEach((video) => {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      items.push({
        url: src,
        type: 'video',
        filename: rkey ? `post_${rkey}_${index}` : null,
      });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target, pathname);
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
      const pathname = window.location.pathname;

      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, target, pathname)
        : resolveAll(target, pathname);

      Promise.resolve(handler)
        .then((urls) => {
          sendResponse({ urls: urls || [], platform: 'bluesky' });
        })
        .catch((err) => {
          console.error('SocialSnag bluesky error:', err);
          sendResponse({ urls: [], platform: 'bluesky' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
