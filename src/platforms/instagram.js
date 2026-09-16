// SocialSnag — Instagram content script

import {
  findNearestMedia,
  findPostContainer,
  getCapturedMedia,
  hostMatches,
  withItemMeta,
} from './common.js';
import { selectByQuality } from './instagram-api.js';

// --- Pure functions (exported for testing) ---

export function upgradeImageUrl(url, imgElement, preference = 'largest') {
  if (!hostMatches(url, 'cdninstagram.com')) return null;

  // Select from srcset at the requested quality.
  if (imgElement?.srcset) {
    const candidates = imgElement.srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      const width = parseInt(parts[1]) || 0;
      return { url: parts[0], width };
    });
    const selected = selectByQuality(candidates, (candidate) => candidate.width, preference);
    if (selected) return selected;
  }

  // Remove size constraints from URL path
  return url.replace(/\/s\d+x\d+\//, '/');
}

// Known Instagram photo filenames keep their path across grid and carousel renders.
// Only the identity drops their query; the selected download URL keeps it. Unknown
// filenames retain the caller's URL key so their existing behavior stays intact.
function imageDedupeKey(url) {
  const upgraded = upgradeImageUrl(url, null);
  if (!upgraded) return null;
  const parsed = new URL(upgraded);
  const knownPhoto = /\/\d+_\d{10,}_\d+_n\.[a-z0-9]+$/i.test(parsed.pathname);
  return knownPhoto ? `photo:${parsed.origin}${parsed.pathname}` : `url:${url}`;
}

function capturedImageWidth(url) {
  const parsed = new URL(url);
  const pathWidth = parsed.pathname.match(/\/s(\d+)x\d+\//)?.[1];
  const queryWidth = parsed.searchParams.get('stp')?.match(/(?:^|_)[sp](\d+)x\d+(?:_|$)/)?.[1];
  return Number(pathWidth || queryWidth) || Infinity;
}

// Instagram `oe` is a hex Unix timestamp. Fixture values like `oe=111` are not
// real expiries; only timestamps in the unix-seconds range are treated as live.
function instagramExpiryMs(url) {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (!oe) return null;
    const unix = parseInt(oe, 16);
    if (!Number.isFinite(unix) || unix < 1_000_000_000) return null;
    return unix * 1000;
  } catch {
    return null;
  }
}

function usableVariants(variants, now = Date.now()) {
  const live = variants.filter((variant) => {
    const expiry = instagramExpiryMs(variant.url);
    return expiry == null || expiry > now;
  });
  return live.length ? live : variants.slice(-1);
}

function selectCapturedUrl(variants, preference) {
  return selectByQuality(
    usableVariants(variants),
    (variant) => variant.width,
    preference,
  );
}

/**
 * Build image items in document order. The first rendition keeps its position
 * and metadata; a later repeat can replace its URL when it better matches the
 * quality preference or refreshes an equal-width signature.
 *
 * `considered` counts usable images before deduping. resolveAll uses that count
 * for its sparse-DOM guard because page-wide captures can include other posts.
 * Changing the download count must not change what the DOM offered.
 */
export function buildImageItems(images, shortcode, startIndex = 1, preference = 'largest') {
  const items = [];
  const itemIndexByIdentity = new Map();
  let index = startIndex;
  let considered = 0;

  for (const img of images) {
    const url = upgradeImageUrl(img?.src, img, preference);
    if (!url) continue;
    considered++;
    const key = imageDedupeKey(url);
    if (itemIndexByIdentity.has(key)) {
      const itemIndex = itemIndexByIdentity.get(key);
      const currentUrl = items[itemIndex].url;
      const selectedUrl = selectByQuality([
        { url, width: capturedImageWidth(url) },
        { url: currentUrl, width: capturedImageWidth(currentUrl) },
      ], (candidate) => candidate.width, preference);
      items[itemIndex] = { ...items[itemIndex], url: selectedUrl };
      continue;
    }
    itemIndexByIdentity.set(key, items.length);

    items.push(withItemMeta({
      url,
      type: 'image',
      filename: shortcode ? `post_${shortcode}_${index}` : null,
    }, { postId: shortcode }));
    index++;
  }

  return { items, index, considered };
}

/**
 * Merge page-wide captures into a sparse DOM result. Compare photo identities,
 * then keep the most recently requested distinct photos within the capture cap.
 * A repeat moves to the end without discarding its larger captured rendition.
 *
 * The historical largest setting still strips a path size from its chosen URL.
 * Capped settings keep the raw captured URL. Query tokens stay intact in both
 * cases; URL identity must never become the download URL.
 */
export function mergeCapturedImages(
  items,
  captured,
  shortcode,
  startIndex = 1,
  limit = 10,
  preference = 'largest',
) {
  const merged = items.map((item) => ({ ...item }));
  const itemIndexByIdentity = new Map();
  for (let i = 0; i < merged.length; i++) {
    const identity = imageDedupeKey(upgradeImageUrl(merged[i].url, null));
    if (identity) itemIndexByIdentity.set(identity, i);
  }
  // A Map keeps insertion order, so deleting before setting moves a repeated capture to
  // the end and leaves the keys in last-seen order.
  const lastSeen = new Map();

  for (const c of captured) {
    if (c?.type !== 'image') continue;
    const identity = imageDedupeKey(upgradeImageUrl(c.url, null));
    if (!identity) continue;

    const width = capturedImageWidth(c.url);
    const existingIndex = itemIndexByIdentity.get(identity);
    if (existingIndex !== undefined) {
      const currentUrl = merged[existingIndex].url;
      const selectedUrl = selectCapturedUrl([
        { url: currentUrl, width: capturedImageWidth(currentUrl) },
        { url: c.url, width },
      ], preference);
      merged[existingIndex] = { ...merged[existingIndex], url: selectedUrl };
      continue;
    }

    const variants = lastSeen.get(identity) || [];
    const sameWidthIndex = variants.findIndex((variant) => variant.width === width);
    if (sameWidthIndex === -1) variants.push({ url: c.url, width });
    else variants[sameWidthIndex] = { url: c.url, width };
    lastSeen.delete(identity);
    lastSeen.set(identity, variants);
  }

  const distinct = [...lastSeen.entries()];
  const kept = distinct.slice(-limit);

  let index = startIndex;
  for (const [, variants] of kept) {
    // The historical "largest" behavior removes the size segment. A capped
    // preference instead chooses among the renditions Chrome actually captured;
    // inventing a CDN size that was never observed would make the URL unreliable.
    const selected = selectCapturedUrl(variants, preference);
    const url = preference === 'largest' ? upgradeImageUrl(selected, null) : selected;
    merged.push({
      url,
      type: 'image',
      filename: shortcode ? `post_${shortcode}_${index}` : null,
    });
    index++;
  }

  return { items: merged, index, dropped: distinct.length - kept.length };
}

export function extractShortcode(pathname) {
  const match = pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

// Feed and profile-grid posts have no shortcode in the page URL, but the post's
// own permalink (its timestamp link) is in the DOM as /p/<code>/, /reel/<code>/,
// or /tv/<code>/. Profile (/username/) and explore links don't match, so the
// first hit is the post itself. Returns the shortcode or null.
export function shortcodeFromContainer(hrefs) {
  for (const href of hrefs) {
    const match = href && href.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (match) return match[2];
  }
  return null;
}

export function parseMediaFromJson(jsonStrings) {
  const items = [];

  for (const text of jsonStrings) {
    try {
      const data = JSON.parse(text);
      if (data.image) {
        const images = Array.isArray(data.image) ? data.image : [data.image];
        images.forEach((imgUrl, i) => {
          items.push({
            url: imgUrl,
            type: 'image',
            index: i + 1,
          });
        });
      }
    } catch (e) { /* ignore */ }
  }

  return items;
}

// Decode JSON escape sequences in extracted URL strings
function decodeJsonString(str) {
  return str
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractVideoUrlFromScripts(scriptTexts, preference = 'largest') {
  for (const text of scriptTexts) {
    if (!text) continue;

    // video_versions carries the candidate widths needed to honor a cap. Prefer
    // it over video_url when both appear in the same payload.
    if (text.includes('video_versions')) {
      const arrayMatch = text.match(/"video_versions"\s*:\s*\[([\s\S]*?)\]/);
      const versions = (arrayMatch?.[1].match(/\{[^{}]*\}/g) || []).map((entry) => {
        const url = entry.match(/"url"\s*:\s*"(https?:[^"]+)"/)?.[1];
        const width = Number(entry.match(/"width"\s*:\s*(\d+)/)?.[1]) || 0;
        return url ? { url: decodeJsonString(url), width } : null;
      }).filter(Boolean);
      const selected = selectByQuality(versions, (version) => version.width, preference);
      if (selected) return selected;
    }

    // Match "video_url":"https://...cdninstagram.com/..."
    if (text.includes('video_url')) {
      const match = text.match(/"video_url":"(https?:[^"]+)"/);
      if (match) {
        return decodeJsonString(match[1]);
      }
    }

  }
  return null;
}

// --- Browser wiring (not exported) ---

export function extractFromPageJson(pathname, preference = 'largest') {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const jsonStrings = Array.from(scripts).map((s) => s.textContent);
  const parsed = parseMediaFromJson(jsonStrings);
  const shortcode = extractShortcode(pathname);
  const domImages = Array.from(document.querySelectorAll('img[src*="cdninstagram.com"]'));

  return parsed.map((item) => {
    const identity = upgradeImageUrl(item.url, null);
    const matchingImage = identity && domImages.find(
      (image) => upgradeImageUrl(image?.src, null) === identity,
    );
    const url = matchingImage
      ? upgradeImageUrl(item.url, matchingImage, preference)
      : item.url;

    return withItemMeta({
      url,
      type: item.type,
      filename: shortcode ? `post_${shortcode}_${item.index}` : null,
    }, { postId: shortcode });
  });
}

export function resolveSingle(srcUrl, target, pathname, preference = 'largest') {
  const shortcode = shortcodeForTarget(target, pathname);
  const filenameShortcode = extractShortcode(pathname);
  const url = upgradeImageUrl(srcUrl, target, preference);
  if (url) {
    return [withItemMeta(
      {
        url,
        type: 'image',
        filename: filenameShortcode ? `post_${filenameShortcode}` : null,
      },
      { postId: shortcode },
    )];
  }

  // If click landed on overlay, find nearest media
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeImageUrl(nearest.src, nearest, preference);
    if (upgraded) {
      return [withItemMeta(
        {
          url: upgraded,
          type: 'image',
          filename: filenameShortcode ? `post_${filenameShortcode}` : null,
        },
        { postId: shortcode },
      )];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      return [withItemMeta(
        {
          url: src,
          type: 'video',
          filename: filenameShortcode ? `reel_${filenameShortcode}` : null,
        },
        { postId: shortcode },
      )];
    }

    // blob: URL — try to extract the real CDN URL from page scripts
    const scripts = document.querySelectorAll('script');
    const scriptTexts = Array.from(scripts).map((s) => s.textContent);
    const cdnUrl = extractVideoUrlFromScripts(scriptTexts, preference);
    if (cdnUrl) {
      return [{
        url: cdnUrl,
        type: 'video',
        filename: filenameShortcode ? `reel_${filenameShortcode}` : null,
      }];
    }

    // Fall back to API lookup via background script
    if (shortcode) {
      return [withItemMeta({
        type: 'video',
        filename: filenameShortcode ? `reel_${filenameShortcode}` : null,
        shortcode,
        needsVideoLookup: true,
      }, { postId: shortcode })];
    }
  }

  // Fall back to resolveAll
  return [];
}

// Exported for the domCount test. The seam between the deduped list and the count
// resolveAll reads is where this change could regress silently, so it needs to be
// reachable without a DOM.
export function collectMediaFromContainer(container, shortcode, preference = 'largest') {
  const images = Array.from(container.querySelectorAll('img[src*="cdninstagram.com"]'));
  const built = buildImageItems(images, shortcode, 1, preference);
  const items = built.items;
  // The video loop below keeps numbering where the images stopped, so a carousel of
  // photos and clips reads as one sequence.
  let index = built.index;
  // Read before the video loop, because `items` IS built.items and the loop pushes
  // into it. built.considered is a number and safe to read at any point.
  const imageItemCount = built.items.length;

  // Cache script texts once for all video elements (avoid re-querying DOM per video)
  let _cachedScriptTexts = null;
  function getScriptTexts() {
    if (!_cachedScriptTexts) {
      _cachedScriptTexts = Array.from(document.querySelectorAll('script')).map((s) => s.textContent);
    }
    return _cachedScriptTexts;
  }

  const usedVideoUrls = new Set();
  container.querySelectorAll('video').forEach((video) => {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      if (!usedVideoUrls.has(src)) {
        usedVideoUrls.add(src);
        items.push(withItemMeta({
          url: src,
          type: 'video',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        }, { postId: shortcode }));
        index++;
      }
    } else if (src && src.startsWith('blob:')) {
      // blob: URL — try to extract real CDN URL from page scripts
      const cdnUrl = extractVideoUrlFromScripts(getScriptTexts(), preference);
      if (cdnUrl && !usedVideoUrls.has(cdnUrl)) {
        usedVideoUrls.add(cdnUrl);
        items.push({
          url: cdnUrl,
          type: 'video',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        });
        index++;
      } else if (shortcode && !usedVideoUrls.has('api:' + shortcode)) {
        // Fall back to API lookup
        usedVideoUrls.add('api:' + shortcode);
        items.push(withItemMeta({
          type: 'video',
          filename: shortcode ? `reel_${shortcode}` : null,
          shortcode,
          needsVideoLookup: true,
        }, { postId: shortcode }));
        index++;
      }
    }
  });

  // What the DOM offered, not what survived the dedupe. resolveAll's sparse check
  // reads this; buildImageItems explains why the two have to differ.
  const domCount = built.considered + (items.length - imageItemCount);

  return { items, index, domCount };
}

function findBroadContainer(target) {
  let el = target;
  const body = globalThis.document?.body;
  while (el && el !== body) {
    el = el.parentElement;
    if (!el) break;
    const mediaCount = el.querySelectorAll('img[src*="cdninstagram.com"]').length
      + el.querySelectorAll('video').length;
    if (mediaCount > 1) {
      return el;
    }
  }
  return null;
}

// Ancestor <a> hrefs of the clicked element, nearest-first. On a profile grid a
// thumbnail is wrapped in its own <a href="/p/...">, so anchoring the shortcode
// to the clicked target resolves the post the user actually clicked rather than
// the first permalink in a shared row container.
function ancestorHrefs(el) {
  const hrefs = [];
  const body = globalThis.document?.body;
  let node = el;
  while (node && node !== body) {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href) hrefs.push(href);
    }
    node = node.parentElement;
  }
  return hrefs;
}

// Descendant <a> hrefs of a container, in DOM order.
function descendantHrefs(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
}

function shortcodeForTarget(target, pathname) {
  const ownerHrefs = ancestorHrefs(target);
  // An enclosing link owns the selected media. A profile avatar's /username/
  // link is not a post permalink, so do not fall through to the article's post.
  if (ownerHrefs.length > 0) return shortcodeFromContainer(ownerHrefs);
  return shortcodeFromContainer(descendantHrefs(target?.closest?.('article')))
    || extractShortcode(pathname);
}

async function resolveAll(target, pathname, preference = 'largest') {
  const urlShortcode = extractShortcode(pathname);

  // Try JSON extraction first for carousel data
  const jsonItems = extractFromPageJson(pathname, preference);
  if (jsonItems.length > 0) return { items: jsonItems, shortcode: urlShortcode };

  // Fall back to DOM collection
  let post = findPostContainer(target, [
    'article',
    '[role="presentation"]',
    '[role="dialog"]',
    'div._aagv',
    'div._aatk',
    'div._ab8w',
  ]);

  // If no known container matched, try broader ancestor walk
  if (!post) {
    post = findBroadContainer(target);
  }

  if (!post) {
    return {
      items: resolveSingle(target?.src || '', target, pathname, preference),
      shortcode: urlShortcode,
    };
  }

  // On the feed/grid the URL has no shortcode; read the post's permalink from
  // the DOM so the background can enumerate the whole carousel via the API (the
  // DOM only renders ~2 slides at a time). Try three scopes in order:
  //   1. ancestors of the clicked target — a grid thumbnail wraps its own /p/
  //      link, so this resolves the exact post the user clicked;
  //   2. the enclosing <article> — in the feed the permalink is the timestamp
  //      link in the article header, which is neither an ancestor of the media
  //      nor inside the narrow media wrapper findPostContainer often returns;
  //   3. the resolved container itself, as a last resort.
  const shortcode = shortcodeForTarget(target, pathname)
    || shortcodeFromContainer(descendantHrefs(post));
  const { items, index: nextIndex, domCount } = collectMediaFromContainer(
    post,
    shortcode,
    preference,
  );
  let index = nextIndex;

  // If the DOM only offered one piece of media, check webRequest captures for more.
  // domCount rather than items.length: the captures below are page-wide and reach
  // into neighbouring posts, so this has to ask what the page held, not what survived
  // the image dedupe. A single photo rendered at two sizes is a full DOM.
  let merged = items;
  if (domCount <= 1) {
    const captured = await getCapturedMedia();
    let dropped = 0;
    ({ items: merged, index, dropped } = mergeCapturedImages(
      items,
      captured,
      shortcode,
      index,
      10,
      preference,
    ));
    if (dropped > 0) {
      // The user has no other way to tell page-wide capture noise from this post's media.
      console.info(
        `SocialSnag instagram: ${dropped} older captured image(s) not included; `
        + 'captures are page-wide, so only the most recent are treated as this post.',
      );
    }
  }

  return {
    items: merged.length > 0
      ? merged
      : resolveSingle(target?.src || '', target, pathname, preference),
    shortcode,
  };
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

      Promise.resolve()
        .then(() => (message.type === 'single'
          ? {
              items: resolveSingle(message.srcUrl, target, pathname, message.preference),
              shortcode: null,
            }
          : resolveAll(target, pathname, message.preference)))
        .then((result) => {
          sendResponse({ urls: result.items || [], platform: 'instagram', shortcode: result.shortcode || null });
        })
        .catch((err) => {
          console.error('SocialSnag instagram error:', err);
          sendResponse({ urls: [], platform: 'instagram' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
