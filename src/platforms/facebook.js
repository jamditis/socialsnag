// SocialSnag — Facebook content script

import {
  findNearestMedia,
  findPostContainer,
  getCapturedMedia,
  hostMatches,
  isContentSized,
} from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeUrl(url) {
  if (!hostMatches(url, 'fbcdn.net')) return null;
  // Try removing size constraints from path
  let upgraded = url.replace(/\/[sp]\d+x\d+\//, '/');
  return upgraded;
}

export function extractPhotoId(url) {
  if (!url) return null;
  const threeNumberFilename = url.match(/\/\d+_(\d{10,})_\d+_n(?:\.[^/?#]+)?(?:[?#]|$)/);
  if (threeNumberFilename) return threeNumberFilename[1];
  const match = url.match(/\/(\d{10,})/);
  return match ? match[1] : null;
}

// Dedupe identity for an already-upgraded fbcdn URL. The photo id is fbcdn's own
// asset number, so it is the stable attribute two renders of one photo share even
// when their size segment and their oh=/oe= signature params differ. Key on it when
// the URL carries one, and fall back to the normalized URL when it does not, so an
// id-less URL still dedupes against an exact repeat. Keys are namespaced so an id
// can never collide with a URL that happens to equal it.
function photoDedupeKey(upgradedUrl) {
  const id = extractPhotoId(upgradedUrl);
  return id ? `id:${id}` : `url:${upgradedUrl}`;
}

// Pixel area an fbcdn URL encodes, used to pick the sharpest render of one photo.
// Size lives either in a /sWxH/ or /pWxH/ path segment or in an stp query token such
// as dst-jpg_s320x320 / _p2048x2048. Score the raw src, since upgradeUrl strips the
// path size before this sees it. A URL with no size token is the unconstrained
// original, so it outranks every sized variant.
function variantArea(url) {
  if (!url) return 0;
  const re = new RegExp('[/_][sp](\\d+)x(\\d+)', 'g');
  let best = 0;
  let sized = false;
  let m;
  while ((m = re.exec(url)) !== null) {
    sized = true;
    best = Math.max(best, Number(m[1]) * Number(m[2]));
  }
  return sized ? best : Infinity;
}

export function extractVideoUrlFromScripts(scriptTexts) {
  for (const text of scriptTexts) {
    if (text.includes('playable_url_quality_hd')) {
      const match = text.match(/"playable_url_quality_hd":"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }
    }
    if (text.includes('playable_url')) {
      const match = text.match(/"playable_url":"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }
    }
  }
  return null;
}

const SUBMITTED_VIDEO_ID_FIELDS = new Set([
  'id',
  'fbid',
  'video_id',
  'videoId',
  'videoID',
  'video_id_original',
]);
const SUBMITTED_VIDEO_URL_FIELDS = [
  'playable_url_quality_hd',
  'browser_native_hd_url',
  'hd_src',
  'playable_url',
  'browser_native_sd_url',
  'sd_src',
];
const SUBMITTED_SCRIPT_BYTE_LIMIT = 5_000_000;
const SUBMITTED_SCRIPT_TOTAL_LIMIT = 10_000_000;
const SUBMITTED_SCRIPT_NODE_LIMIT = 25_000;

function directStructuredVideoUrl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const field of SUBMITTED_VIDEO_URL_FIELDS) {
    if (typeof value[field] === 'string' && value[field].startsWith('https://')) {
      return value[field];
    }
  }
  return null;
}

function directStructuredIds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([field, fieldValue]) => (
      SUBMITTED_VIDEO_ID_FIELDS.has(field)
      && (typeof fieldValue === 'string' || typeof fieldValue === 'number')
    ))
    .map(([, fieldValue]) => String(fieldValue));
}

function findMatchedStructuredVideo(value, requestedIds, state, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 24) return null;
  if (++state.nodes > SUBMITTED_SCRIPT_NODE_LIMIT) return null;

  if (!Array.isArray(value)) {
    const localIds = directStructuredIds(value);
    if (localIds.length > 0 && localIds.every((id) => requestedIds.has(id))) {
      const found = directStructuredVideoUrl(value);
      if (found) return found;
    }
  }

  for (const child of Object.values(value)) {
    const found = findMatchedStructuredVideo(child, requestedIds, state, depth + 1);
    if (found) return found;
  }
  return null;
}

// Facebook's video element normally exposes a blob: URL. Its application/json
// payloads carry the underlying HD/SD CDN URL, but a page can also contain reply,
// recommendation, and advertisement videos. Parse only bounded scripts that name
// the verified post id, then return a URL from the same
// structured object. A document-wide playable_url regex cannot prove ownership.
export function extractSubmittedVideoUrl(scriptTexts, videoIds) {
  const requestedIds = new Set(
    Array.from(videoIds || [], (id) => String(id)).filter(Boolean),
  );
  if (requestedIds.size === 0) return null;

  let inspectedBytes = 0;
  const state = { nodes: 0 };
  for (const rawText of scriptTexts || []) {
    if (typeof rawText !== 'string' || rawText.length === 0) continue;
    if (rawText.length > SUBMITTED_SCRIPT_BYTE_LIMIT) continue;
    inspectedBytes += rawText.length;
    if (inspectedBytes > SUBMITTED_SCRIPT_TOTAL_LIMIT) break;
    if (!SUBMITTED_VIDEO_URL_FIELDS.some((field) => rawText.includes(field))) continue;
    if (![...requestedIds].some((id) => rawText.includes(id))) continue;

    let value;
    try {
      value = JSON.parse(rawText);
    } catch {
      continue;
    }
    const found = findMatchedStructuredVideo(value, requestedIds, state);
    if (found) return found;
    if (state.nodes > SUBMITTED_SCRIPT_NODE_LIMIT) break;
  }
  return null;
}

/**
 * Turn a post's <img> elements into download items, in document order.
 *
 * Deduping is the point, and it keys on the stable fbcdn photo id, not on the URL.
 * upgradeUrl strips the size segment, so the grid thumbnail `/s320x320/123_n.jpg`
 * and the full view `/p720x720/123_n.jpg` already collapse to one URL. But Facebook
 * also re-renders one slide with fresh `oh=`/`oe=` signature params, which the size
 * strip leaves in place, so a URL key would count those two as separate photos. photoDedupeKey
 * uses extractPhotoId (fbcdn's own asset number), so every render of one slide
 * collapses to a single item regardless of size or signature; a URL with no id
 * falls back to the normalized URL. Without this the `_${index}` suffix hides the
 * repeats: one photo saved twice reads as a two-photo album.
 *
 * The first variant seen holds its position, which keeps document order intact.
 * Document order is what makes album ordering stable, since querySelectorAll returns
 * it and it matches how the slides read on the page. But size can also live in the stp
 * query token, which upgradeUrl does not strip, so a grid thumbnail
 * (?stp=..._s320x320_...) and the opened full view (?stp=..._p2048x2048_...) keep
 * distinct URLs under one id. First-seen alone would hand back the thumbnail, so a
 * sharper later render replaces the URL at the position its first sighting won.
 *
 * @param {Array<{src: string, width?: number, naturalWidth?: number}>} images
 * @param {number} startIndex first filename suffix to use
 * @returns {{items: Array<object>, index: number}} items and the next free index
 */
export function buildImageItems(images, startIndex = 1) {
  const items = [];
  // key -> { itemIndex, area }: the position a photo's first sighting won, and the
  // sharpest variant placed so far, so a repeat can upgrade the URL without moving it.
  const placed = new Map();
  let index = startIndex;

  for (const img of images) {
    const url = upgradeUrl(img.src);
    if (!url) continue;
    if (!isContentSized(img)) continue;
    const key = photoDedupeKey(url);
    const area = variantArea(img.src);

    const prior = placed.get(key);
    if (prior) {
      if (area > prior.area) {
        items[prior.itemIndex].url = url;
        prior.area = area;
      }
      continue;
    }

    const id = extractPhotoId(url);
    placed.set(key, { itemIndex: items.length, area });
    items.push({ url, type: 'image', filename: id ? `photo_${id}_${index}` : null });
    index++;
  }

  return { items, index };
}

/**
 * Turn webRequest-captured CDN URLs into download items, used when the DOM walk
 * found nothing.
 *
 * Runs the same upgradeUrl normalization as the DOM path, and for both of its
 * reasons. The browser requests whichever size it renders, so a photo shown as a
 * thumbnail and then full size is captured twice, and keying on the raw URL would
 * treat those as two photos while handing back the thumbnail to download.
 *
 * Identity is the stable fbcdn photo id via photoDedupeKey, the same key the DOM
 * path uses, so two captures of one photo collapse whether they differ in size or in
 * their `oh=` / `oe=` signature parameters. A capture whose URL carries no id falls
 * back to its normalized URL, so an id-less repeat still collapses while two distinct
 * id-less photos stay separate.
 *
 * Capture order is network arrival order, not page order, so this cannot recover
 * album ordering the way the DOM path does. What it can do is be deterministic:
 * dedupe first, then cap, so the cap is spent on distinct photos rather than on
 * repeats of one.
 *
 * The cap exists because captures are page-wide and include media from neighbouring
 * posts and ads. It returns how many it dropped so the caller can say so rather than
 * silently truncating.
 *
 * Note the tie-break runs the opposite way from buildImageItems, and deliberately.
 * There, a repeat is the same slide rendered twice and the first sighting carries
 * the document position, so first wins. Here the ordering means recency: the store
 * is page-wide and spans posts the user already scrolled past, so a photo being
 * requested again is evidence it belongs to what is on screen now. Keeping its first
 * sighting would age it out of the cap in favour of an older unrelated capture.
 *
 * @param {Array<{url: string, type: string}>} captured
 * @param {number} limit most items to return
 * @returns {{items: Array<object>, dropped: number}}
 */
export function buildCapturedItems(captured, limit = 5) {
  // A Map keeps insertion order, so deleting before setting moves a repeated photo
  // to the end and leaves it in last-seen order. Keyed by photoDedupeKey (the photo
  // id, or the URL when it carries none); the value holds the sharpest URL variant
  // seen for that photo and its area. Recency still follows the latest request.
  const lastSeen = new Map();

  for (const c of captured) {
    if (!c?.url || c.type !== 'image') continue;
    // upgradeUrl carries the host check, so a lookalike host returns null here.
    const url = upgradeUrl(c.url);
    if (!url) continue;
    const key = photoDedupeKey(url);
    const area = variantArea(c.url);
    const prior = lastSeen.get(key);
    const variant = prior && prior.area > area ? prior : { url, area };
    lastSeen.delete(key);
    lastSeen.set(key, variant);
  }

  const distinct = [...lastSeen.values()].map(({ url }) => url);
  // Keep the most recent, which are the likeliest to belong to the post just opened.
  const kept = distinct.slice(-limit);
  let index = 1;
  const items = kept.map((url) => ({ url, type: 'image', filename: `photo_${index++}` }));

  return { items, dropped: distinct.length - kept.length };
}

// --- Browser wiring (not exported) ---

function findVideoUrl(target, { allowDocumentScripts = true } = {}) {
  const container = target?.closest?.('[role="article"]') || target?.parentElement;
  if (!container) return null;

  const video = container.querySelector('video');
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) return src;
  }

  if (!allowDocumentScripts) return null;

  // Try to find playable_url in page scripts
  const scripts = document.querySelectorAll('script');
  const scriptTexts = Array.from(scripts).map((s) => s.textContent);
  return extractVideoUrlFromScripts(scriptTexts);
}

function resolveSingle(srcUrl, target, { allowDocumentScripts = true } = {}) {
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPhotoId(srcUrl);
    return [{ url, type: 'image', filename: id ? `photo_${id}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPhotoId(nearest.src);
      return [{ url: upgraded, type: 'image', filename: id ? `photo_${id}` : null }];
    }
  }

  const videoUrl = findVideoUrl(target, { allowDocumentScripts });
  if (videoUrl) {
    return [{ url: videoUrl, type: 'video', filename: null }];
  }

  return [];
}

async function resolveAll(
  target,
  { allowCaptured = true, allowDocumentScripts = true } = {},
) {
  const post = findPostContainer(target, [
    '[role="article"]',
    '[data-pagelet*="FeedUnit"]',
    '[data-pagelet*="ProfileTimeline"]',
  ]);
  if (!post) return resolveSingle(target?.src || '', target, { allowDocumentScripts });

  // querySelectorAll returns document order, which is the album's own slide order.
  const domImages = Array.from(post.querySelectorAll('img[src*="fbcdn.net"]'));
  const { items } = buildImageItems(domImages);

  // Fall back to webRequest captures if DOM is sparse. Numbering restarts at 1 by
  // construction: this branch only runs when the DOM walk produced nothing.
  if (items.length === 0) {
    if (!allowCaptured) {
      return resolveSingle(target?.src || '', target, { allowDocumentScripts });
    }
    const captured = await getCapturedMedia();
    const fallback = buildCapturedItems(captured);
    if (fallback.dropped > 0) {
      console.info(
        `SocialSnag facebook: ${fallback.dropped} older captured image(s) not included; `
        + 'captures are page-wide, so only the most recent are treated as this post.',
      );
    }
    return fallback.items.length > 0
      ? fallback.items
      : resolveSingle(target?.src || '', target, { allowDocumentScripts });
  }

  return items;
}

function facebookSubmittedKey(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, 'https://www.facebook.com');
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null;

  const path = url.pathname;
  let match = path.match(/^\/groups\/[^/]+\/(?:posts|permalink)\/([^/]+)\/?$/)
    || path.match(/^\/[^/]+\/posts\/([^/]+)\/?$/);
  if (match) return `post:${match[1]}`;

  match = path.match(/^\/[^/]+\/photos\/(?:[^/]+\/)?(\d+)\/?$/);
  if (match) return `photo:${match[1]}`;

  match = path.match(/^\/[^/]+\/videos\/(\d+)\/?$/)
    || path.match(/^\/reel\/(\d+)\/?$/);
  if (match) return `video:${match[1]}`;

  match = path.match(/^\/share\/([prv])\/([A-Za-z0-9_-]+)\/?$/);
  if (match) return `share:${match[1]}:${match[2]}`;

  if (path === '/photo.php' || /^\/photo\/?$/.test(path)) {
    const id = url.searchParams.get('fbid');
    return id ? `photo:${id}` : null;
  }
  if (path === '/permalink.php' || path === '/story.php') {
    const id = url.searchParams.get('story_fbid');
    return id ? `post:${id}` : null;
  }
  if (/^\/watch\/?$/.test(path)) {
    const id = url.searchParams.get('v');
    return id ? `video:${id}` : null;
  }
  return null;
}

function hasFacebookPermalink(container, requestedKey) {
  const links = container.querySelectorAll?.('a[href]') || [];
  return Array.from(links).some((link) => facebookSubmittedKey(link.href) === requestedKey);
}

function submittedVideoIds(requestedKey) {
  const ids = new Set();
  const requestedId = requestedKey?.match(/^(?:post|photo|video):(.+)$/)?.[1];
  if (requestedId) ids.add(requestedId);
  return ids;
}

function directVideoIds(video) {
  return new Set([
    video?.dataset?.videoId,
    video?.getAttribute?.('data-video-id'),
  ].filter((id) => id !== null && id !== undefined && String(id) !== '')
    .map((id) => String(id)));
}

function directVideoMatches(video, requestedIds) {
  const ownIds = directVideoIds(video);
  return ownIds.size > 0 && [...ownIds].every((id) => requestedIds.has(id));
}

function resolveSubmittedVideo(container, requestedKey, root) {
  const ids = submittedVideoIds(requestedKey);
  const filenameId = [...ids][0] || null;
  const queriedVideos = Array.from(container.querySelectorAll?.('video') || []);
  const fallbackVideo = container.querySelector?.('video');
  const videos = queriedVideos.length > 0
    ? queriedVideos
    : (fallbackVideo ? [fallbackVideo] : []);

  const directVideo = videos.find((video) => {
    const url = video.currentSrc || video.src || video.querySelector?.('source')?.src;
    return url && !url.startsWith('blob:') && directVideoMatches(video, ids);
  });
  if (directVideo) {
    const directUrl = directVideo.currentSrc
      || directVideo.src
      || directVideo.querySelector?.('source')?.src;
    return {
      url: directUrl,
      type: 'video',
      filename: filenameId ? `video_${filenameId}` : null,
    };
  }

  const scriptTexts = Array.from(root.querySelectorAll?.('script') || [], (script) => (
    script.textContent || ''
  ));
  const url = extractSubmittedVideoUrl(scriptTexts, ids);
  return url ? {
    url,
    type: 'video',
    filename: filenameId ? `video_${filenameId}` : null,
  } : null;
}

// Resolve only a container or media link whose permalink proves it owns the
// submitted Facebook identifier. Captured-media fallback is intentionally off
// here because those requests are page-wide and cannot prove post ownership.
export async function resolvePage(
  root = document,
  pageUrl = globalThis.window?.location?.href || '',
) {
  const requestedKey = facebookSubmittedKey(pageUrl);
  if (!requestedKey) return [];

  const candidates = root.querySelectorAll?.(
    '[role="article"], [data-pagelet*="FeedUnit"], '
    + '[data-pagelet*="ProfileTimeline"]',
  ) || [];
  for (const candidate of candidates) {
    if (hasFacebookPermalink(candidate, requestedKey)) {
      const domImages = Array.from(
        candidate.querySelectorAll?.('img[src*="fbcdn.net"]') || [],
      );
      const { items } = buildImageItems(domImages);
      const video = resolveSubmittedVideo(candidate, requestedKey, root);
      if (!video || items.some((item) => item.url === video.url)) return items;
      return [...items, video];
    }
  }

  const links = root.querySelectorAll?.('a[href]') || [];
  for (const link of links) {
    if (facebookSubmittedKey(link.href) !== requestedKey) continue;
    const media = link.querySelector?.(
      'img[data-visualcompletion="media-vc-image"], '
      + '[data-pagelet*="Video"] video, video[data-video-id]',
    );
    if (!media) return [];
    const items = media.tagName === 'IMG'
      ? resolveSingle(media.src || '', media, { allowDocumentScripts: false })
      : [];
    const video = resolveSubmittedVideo(link, requestedKey, root);
    if (!video || items.some((item) => item.url === video.url)) return items;
    return [...items, video];
  }
  return [];
}

export async function resolveContentMessage(message, lastTarget, root = document) {
  if (message.action === 'resolvePage') return resolvePage(root, message.pageUrl);
  if (message.action !== 'resolve') return [];
  return message.type === 'single'
    ? resolveSingle(message.srcUrl, lastTarget)
    : resolveAll(lastTarget);
}

function initContentScript() {
  let _lastTarget = null;

  // Track right-click target
  document.addEventListener('contextmenu', (e) => {
    _lastTarget = e.target;
  }, true);

  // Listen for resolve requests from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve' || message.action === 'resolvePage') {
      const target = _lastTarget;

      Promise.resolve()
        .then(() => resolveContentMessage(message, target, document))
        .then((urls) => {
          sendResponse({ urls: urls || [], platform: 'facebook' });
        })
        .catch((err) => {
          console.error('SocialSnag facebook error:', err);
          sendResponse({ urls: [], platform: 'facebook' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
