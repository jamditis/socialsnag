// SocialSnag — Instagram content script

import {
  findNearestMedia,
  findPostContainer,
  getCapturedMedia,
  hostMatches,
  withItemMeta,
} from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeImageUrl(url, imgElement) {
  if (!hostMatches(url, 'cdninstagram.com')) return null;

  // Check srcset for highest resolution
  if (imgElement?.srcset) {
    const candidates = imgElement.srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      const width = parseInt(parts[1]) || 0;
      return { url: parts[0], width };
    });
    candidates.sort((a, b) => b.width - a.width);
    if (candidates.length > 0 && candidates[0].url) {
      return candidates[0].url;
    }
  }

  // Remove size constraints from URL path
  return url.replace(/\/s\d+x\d+\//, '/');
}

/**
 * Turn a post's <img> elements into download items, in document order.
 *
 * Deduping is the point, and it is not defensive. upgradeImageUrl is a normalizer, so
 * it manufactures the duplicates itself. Measured against the real function, both of
 * its branches collapse a carousel slide's variants to one URL:
 *
 *   no srcset   `/s150x150/AAA_n.jpg` and `/s640x640/AAA_n.jpg` both strip to
 *               `/AAA_n.jpg`, so the grid thumbnail and the full view become one URL
 *   srcset      two <img> for one slide carry the same srcset, so both return that
 *               srcset's widest candidate
 *
 * Instagram renders both for a single slide, so without a dedupe the `_${index}`
 * suffix hides the repeat: one photo saved twice reads as a two-photo carousel.
 *
 * The collapse is partial, and the seam is worth naming rather than implying. The
 * srcset branch returns its winner untouched while the fallback strips the size
 * segment, so one <img> with a srcset and one without, for the same photo, upgrade to
 * `/s1080x1080/AAA_n.jpg` and `/AAA_n.jpg` and survive as two items. That is a
 * normalizer inconsistency, not a dedupe one (#70).
 *
 * The first variant seen wins, which keeps document order intact. Document order is
 * what makes carousel ordering stable, since querySelectorAll returns it and it
 * matches how the slides read on the page. facebook.js:buildImageItems makes the same
 * call for the same reason; its capture-order sibling deliberately breaks the tie the
 * other way, which is why this lives per platform rather than in common.js.
 *
 * A carousel that carries the same picture on two slides is expected to keep both,
 * since the key is the URL and the two slides are two uploads. That rests on a CDN path
 * naming an upload rather than an image, which is an inference rather than something
 * this repo proves: facebook.js:extractPhotoId reads a per-media numeric id out of an
 * fbcdn path, and cdninstagram paths are shaped the same way. If it turns out a repeat
 * can share a URL, the collapse there is the cost of collapsing size variants, which is
 * the case that actually has a duplicate to lose.
 *
 * `considered` counts the images the DOM offered, before the dedupe. resolveAll needs
 * it: it reads a small item count as a sparse DOM and goes to the page-wide webRequest
 * captures for more, and those captures span neighbouring posts. Reading the deduped
 * count there would turn the ordinary single-photo post, the one Instagram renders at
 * two sizes, into a sparse DOM and pull a stranger's photos into the download. The
 * dedupe is allowed to change what gets saved; it is not allowed to change what the
 * page looked like.
 *
 * @param {Array<{src: string, srcset?: string}>} images
 * @param {string|null} shortcode post shortcode, for the filename
 * @param {number} startIndex first filename suffix to use
 * @returns {{items: Array<object>, index: number, considered: number}} items, the next
 *   free index, and how many usable images the DOM offered before deduping
 */
export function buildImageItems(images, shortcode, startIndex = 1) {
  const items = [];
  const seen = new Set();
  let index = startIndex;
  let considered = 0;

  for (const img of images) {
    const url = upgradeImageUrl(img?.src, img);
    if (!url) continue;
    considered++;
    if (seen.has(url)) continue;
    seen.add(url);

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
 * Merge page-wide webRequest captures into a DOM result that came back sparse.
 *
 * The same dedupe as buildImageItems, for the same reason, on the other half of the
 * enumeration #46 is about. The old guard compared a raw captured URL against the
 * upgraded URLs already in `items`, so it never matched: one photo could arrive as its
 * DOM entry plus two captured renditions and save three times, two of them at the
 * thumbnail resolution the upgrade exists to get past. Normalizing first makes the
 * comparison meaningful and the saved file the full-size one.
 *
 * upgradeImageUrl also carries the host check, which is stricter than the substring
 * test this replaced: `evilcdninstagram.com` contains `cdninstagram.com`. Nothing was
 * downloadable from it, since background.js blocks the host at download time, but it
 * could spend a slot and surface a failed download.
 *
 * Dedupe first, then cap, so the cap is spent on distinct photos rather than on repeats
 * of one. facebook.js:buildCapturedItems orders it the same way and says why. The cap
 * exists because captures are page-wide: they include media from neighbouring posts and
 * ads, which is also why resolveAll only reaches for them when the DOM had nothing.
 *
 * Capture order is network arrival order rather than page order, so the last ones are
 * the likeliest to belong to the post just opened. That is why the cap keeps the tail,
 * and why a repeat has to move to the end rather than hold its first position: a photo
 * requested again as this post opened belongs to this post, whatever a neighbour did
 * with it earlier. The Map delete-then-set is facebook.js:buildCapturedItems' pattern.
 *
 * Both sides go through the same branch of upgradeImageUrl before they are compared.
 * A DOM item that came from the srcset branch keeps its
 * size segment, since that branch returns its winner untouched, while a capture of the
 * same photo has been stripped. Comparing those raw would append the photo a second
 * time. Passing null for the element runs both through the stripping branch, which
 * leaves the per-media id intact, so two different photos still read as different.
 * The asymmetry belongs to the normalizer and is filed as #70; this function only keeps
 * it out of the comparison, and the URL it stores is still the one the DOM or capture gave.
 *
 * @param {Array<object>} items items already found in the DOM
 * @param {Array<{url: string, type: string}>} captured page-wide captures
 * @param {string|null} shortcode post shortcode, for the filename
 * @param {number} startIndex first filename suffix to use
 * @param {number} limit most captures to append
 * @returns {{items: Array<object>, index: number, dropped: number}} merged list, next
 *   free index, and how many distinct captures the cap left out
 */
export function mergeCapturedImages(items, captured, shortcode, startIndex = 1, limit = 10) {
  const seen = new Set(items.map((i) => upgradeImageUrl(i.url, null)).filter(Boolean));
  // A Map keeps insertion order, so deleting before setting moves a repeated capture to
  // the end and leaves the keys in last-seen order.
  const lastSeen = new Map();

  for (const c of captured) {
    if (c?.type !== 'image') continue;
    const url = upgradeImageUrl(c.url, null);
    if (!url) continue;
    if (seen.has(url)) continue;
    lastSeen.delete(url);
    lastSeen.set(url, true);
  }

  const distinct = [...lastSeen.keys()];
  const kept = distinct.slice(-limit);

  let index = startIndex;
  const merged = [...items];
  for (const url of kept) {
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

export function extractVideoUrlFromScripts(scriptTexts) {
  for (const text of scriptTexts) {
    if (!text) continue;

    // Match "video_url":"https://...cdninstagram.com/..."
    if (text.includes('video_url')) {
      const match = text.match(/"video_url":"(https?:[^"]+)"/);
      if (match) {
        return decodeJsonString(match[1]);
      }
    }

    // Match "video_versions":[{"url":"https://..."}]
    if (text.includes('video_versions')) {
      const match = text.match(/"video_versions"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https?:[^"]+)"/);
      if (match) {
        return decodeJsonString(match[1]);
      }
    }
  }
  return null;
}

// --- Browser wiring (not exported) ---

function extractFromPageJson(pathname) {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const jsonStrings = Array.from(scripts).map((s) => s.textContent);
  const parsed = parseMediaFromJson(jsonStrings);
  const shortcode = extractShortcode(pathname);

  return parsed.map((item) => withItemMeta({
    url: item.url,
    type: item.type,
    filename: shortcode ? `post_${shortcode}_${item.index}` : null,
  }, { postId: shortcode }));
}

export function resolveSingle(srcUrl, target, pathname) {
  const shortcode = shortcodeForTarget(target, pathname);
  const filenameShortcode = extractShortcode(pathname);
  const url = upgradeImageUrl(srcUrl, target);
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
    const upgraded = upgradeImageUrl(nearest.src, nearest);
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
    const cdnUrl = extractVideoUrlFromScripts(scriptTexts);
    if (cdnUrl) {
      return [withItemMeta(
        {
          url: cdnUrl,
          type: 'video',
          filename: filenameShortcode ? `reel_${filenameShortcode}` : null,
        },
        { postId: shortcode },
      )];
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
export function collectMediaFromContainer(container, shortcode) {
  const images = Array.from(container.querySelectorAll('img[src*="cdninstagram.com"]'));
  const built = buildImageItems(images, shortcode);
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
      const cdnUrl = extractVideoUrlFromScripts(getScriptTexts());
      if (cdnUrl && !usedVideoUrls.has(cdnUrl)) {
        usedVideoUrls.add(cdnUrl);
        items.push(withItemMeta({
          url: cdnUrl,
          type: 'video',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        }, { postId: shortcode }));
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
  return extractShortcode(pathname)
    || shortcodeFromContainer(ancestorHrefs(target))
    || shortcodeFromContainer(descendantHrefs(target?.closest?.('article')));
}

async function resolveAll(target, pathname) {
  const urlShortcode = extractShortcode(pathname);

  // Try JSON extraction first for carousel data
  const jsonItems = extractFromPageJson(pathname);
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

  if (!post) return { items: resolveSingle(target?.src || '', target, pathname), shortcode: urlShortcode };

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
  const { items, index: nextIndex, domCount } = collectMediaFromContainer(post, shortcode);
  let index = nextIndex;

  // If the DOM only offered one piece of media, check webRequest captures for more.
  // domCount rather than items.length: the captures below are page-wide and reach
  // into neighbouring posts, so this has to ask what the page held, not what survived
  // the image dedupe. A single photo rendered at two sizes is a full DOM.
  let merged = items;
  if (domCount <= 1) {
    const captured = await getCapturedMedia();
    let dropped = 0;
    ({ items: merged, index, dropped } = mergeCapturedImages(items, captured, shortcode, index));
    if (dropped > 0) {
      // The user has no other way to tell page-wide capture noise from this post's media.
      console.info(
        `SocialSnag instagram: ${dropped} older captured image(s) not included; `
        + 'captures are page-wide, so only the most recent are treated as this post.',
      );
    }
  }

  return {
    items: merged.length > 0 ? merged : resolveSingle(target?.src || '', target, pathname),
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
          ? { items: resolveSingle(message.srcUrl, target, pathname), shortcode: null }
          : resolveAll(target, pathname)))
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
