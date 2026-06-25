// SocialSnag — LinkedIn content script

import { findNearestMedia, findPostContainer } from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeUrl(url) {
  if (!url || !url.includes('media.licdn.com')) return null;
  // LinkedIn serves a downscaled copy under a /shrink_<w>_<h>/ path segment;
  // dropping the segment returns the full-size original.
  return url.replace(/\/shrink_\d+_\d+\//, '/');
}

export function extractPostId(href) {
  if (!href) return null;

  // Post permalinks carry the id as ...-activity-<n>-... ; feed update URNs
  // carry it as urn:li:activity:<n>. Try the permalink form first.
  const match = href.match(/activity-(\d+)/);
  if (match) return match[1];

  const urnMatch = href.match(/urn:li:activity:(\d+)/);
  if (urnMatch) return urnMatch[1];

  return null;
}

// --- Browser wiring (not exported) ---

function resolveSingle(srcUrl, target) {
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPostId(window.location.href);
    return [{ url, type: 'image', filename: id ? `post_${id}` : null }];
  }

  // If the click landed on an overlay, find the nearest media element.
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPostId(window.location.href);
      return [{ url: upgraded, type: 'image', filename: id ? `post_${id}` : null }];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      return [{ url: src, type: 'video', filename: null }];
    }
  }

  return [];
}

function resolveAll(target) {
  const post = findPostContainer(target, [
    '.feed-shared-update-v2',
    '[data-urn]',
    '.social-details-social-activity',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  const id = extractPostId(window.location.href);
  let index = 1;

  post.querySelectorAll('img[src*="media.licdn.com"]').forEach((img) => {
    const url = upgradeUrl(img.src);
    if (url) {
      items.push({ url, type: 'image', filename: id ? `post_${id}_${index}` : null });
      index++;
    }
  });

  post.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      items.push({ url: src, type: 'video', filename: id ? `post_${id}_${index}` : null });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function initContentScript() {
  let _lastTarget = null;

  // Track the right-click target so a resolve message can act on it.
  document.addEventListener('contextmenu', (e) => {
    _lastTarget = e.target;
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      const target = _lastTarget;
      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, target)
        : resolveAll(target);

      Promise.resolve(handler)
        .then((urls) => {
          sendResponse({ urls: urls || [], platform: 'linkedin' });
        })
        .catch((err) => {
          console.error('SocialSnag linkedin error:', err);
          sendResponse({ urls: [], platform: 'linkedin' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
