// SocialSnag — LinkedIn content script

import {
  findNearestMedia,
  findPostContainer,
  hostMatches,
  isContentSized,
} from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeUrl(url) {
  if (!hostMatches(url, 'media.licdn.com')) return null;
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

// A feed card serves the author's avatar and the company mark from the same CDN as
// the post's photos, and LinkedIn names both renditions in the path. Matching the
// name is what works here. Size does not: the avatar is served at 100x100 intrinsic
// and rendered at 48, so it clears any threshold low enough to keep a real photo.
//
// A rendition this does not recognize is kept, which costs an extra file in the zip.
// Erring the other way would drop a photo the user asked for.
const CHROME_RENDITIONS = /\/(profile-displayphoto|company-logo)/;

export function isPostImage(url) {
  return !CHROME_RENDITIONS.test(url);
}

/**
 * Turn a post's <img> elements into download items, in document order.
 *
 * Three things get filtered out: the chrome renditions above, anything too small to
 * be worth saving (a reaction icon is served at the size it renders), and repeats.
 * That last one is why upgradeUrl matters here beyond the size upgrade. It strips
 * the /shrink_<w>_<h>/ segment, so two renditions of one photo normalize to the same
 * URL, and keeping both would number one image `_1` and `_2` and read as a two-image
 * post.
 *
 * @param {Array<{src: string, width?: number, naturalWidth?: number}>} images
 * @param {string|null} postId names the files when the page URL carries one
 * @returns {{items: Array<object>, index: number}} items and the next free index
 */
export function buildImageItems(images, postId = null) {
  const items = [];
  const seen = new Set();
  let index = 1;

  for (const img of images) {
    const url = upgradeUrl(img.src);
    if (!url) continue;
    if (!isPostImage(url)) continue;
    if (!isContentSized(img)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    items.push({ url, type: 'image', filename: postId ? `post_${postId}_${index}` : null });
    index++;
  }

  return { items, index };
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

  const id = extractPostId(window.location.href);
  // querySelectorAll returns document order, which is the post's own image order.
  const { items, index: nextIndex } = buildImageItems(
    Array.from(post.querySelectorAll('img[src*="media.licdn.com"]')),
    id,
  );
  // The video sweep below continues the image numbering.
  let index = nextIndex;

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
      Promise.resolve()
        .then(() => (message.type === 'single'
          ? resolveSingle(message.srcUrl, target)
          : resolveAll(target)))
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
