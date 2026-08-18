// SocialSnag — LinkedIn content script

import {
  findNearestMedia,
  findPostContainer,
  hostMatches,
  isContentSized,
  withItemMeta,
} from './common.js';

// --- Pure functions (exported for testing) ---

// The host gate for every LinkedIn image, and, on paper, a size upgrade. Read the
// second half narrowly: every live URL sampled so far is shaped
// media.licdn.com/dms/image/<id>/feedshare-shrink_2048_1536/0/<ts>?e=..&v=beta&t=<sig>,
// where the rendition is hyphen-prefixed and the path is covered by a signature. The
// bare /shrink_<w>_<h>/ segment this strips has not been observed on a real card, so
// the replace is inert there, and rewriting the prefixed form would likely break `t`.
// Kept as the host gate, which is load-bearing. socialsnag#67 tracks whether any
// client-side upgrade exists; it needs a live card, so it belongs on a browser host.
export function upgradeUrl(url) {
  if (!hostMatches(url, 'media.licdn.com')) return null;
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
 *
 * The repeat check is exact-URL only. An earlier note here claimed upgradeUrl
 * normalized two renditions of one photo onto one URL so they would not number `_1`
 * and `_2`; see upgradeUrl for why that does not hold against live URLs. If LinkedIn
 * does serve one photo at two sizes in a card, this will still emit both.
 *
 * @param {Array<{src: string, width?: number, naturalWidth?: number}>} images
 * @param {string|null} postId names the files when the page URL carries one
 * @param {string|null} metadataPostId verified owner for opt-in filename templates
 * @returns {{items: Array<object>, index: number}} items and the next free index
 */
export function buildImageItems(images, postId = null, metadataPostId = postId) {
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

    items.push(withItemMeta(
      { url, type: 'image', filename: postId ? `post_${postId}_${index}` : null },
      { postId: metadataPostId },
    ));
    index++;
  }

  return { items, index };
}

// --- Browser wiring (not exported) ---

function resolveSingle(srcUrl, target) {
  const postId = linkedinPostIdForTarget(target);
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPostId(window.location.href);
    return [withItemMeta(
      { url, type: 'image', filename: id ? `post_${id}` : null },
      { postId: postId || id },
    )];
  }

  // If the click landed on an overlay, find the nearest media element.
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPostId(window.location.href);
      return [withItemMeta(
        { url: upgraded, type: 'image', filename: id ? `post_${id}` : null },
        { postId: postId || id },
      )];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      const id = extractPostId(window.location.href);
      return [withItemMeta(
        { url: src, type: 'video', filename: null },
        { postId: postId || id },
      )];
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
  const metadataPostId = linkedinPostIdFromContainer(post) || id;
  // querySelectorAll returns document order, which is the post's own image order.
  const { items, index: nextIndex } = buildImageItems(
    Array.from(post.querySelectorAll('img[src*="media.licdn.com"]')),
    id,
    metadataPostId,
  );
  // The video sweep below continues the image numbering.
  let index = nextIndex;

  post.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      items.push(withItemMeta(
        { url: src, type: 'video', filename: id ? `post_${id}_${index}` : null },
        { postId: metadataPostId },
      ));
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function linkedinPostIdFromContainer(container) {
  const candidates = [
    container?.dataset?.urn,
    container?.getAttribute?.('data-urn'),
    ...Array.from(container?.querySelectorAll?.('a[href]') || [], (link) => link.href),
  ];
  for (const candidate of candidates) {
    const postId = extractPostId(candidate);
    if (postId) return postId;
  }
  return null;
}

function linkedinPostIdForTarget(target) {
  const container = findPostContainer(target, [
    '.feed-shared-update-v2',
    '[data-urn]',
    '.social-details-social-activity',
  ]);
  return linkedinPostIdFromContainer(container);
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
