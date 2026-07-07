// SocialSnag — Instagram content script

import { findNearestMedia, findPostContainer, getCapturedMedia, hostMatches } from './common.js';

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

  return parsed.map((item) => ({
    url: item.url,
    type: item.type,
    filename: shortcode ? `post_${shortcode}_${item.index}` : null,
  }));
}

function resolveSingle(srcUrl, target, pathname) {
  const url = upgradeImageUrl(srcUrl, target);
  if (url) {
    const shortcode = extractShortcode(pathname);
    return [{ url, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeImageUrl(nearest.src, nearest);
    if (upgraded) {
      const shortcode = extractShortcode(pathname);
      return [{ url: upgraded, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      const shortcode = extractShortcode(pathname);
      return [{ url: src, type: 'video', filename: shortcode ? `reel_${shortcode}` : null }];
    }

    // blob: URL — try to extract the real CDN URL from page scripts
    const scripts = document.querySelectorAll('script');
    const scriptTexts = Array.from(scripts).map((s) => s.textContent);
    const cdnUrl = extractVideoUrlFromScripts(scriptTexts);
    if (cdnUrl) {
      const shortcode = extractShortcode(pathname);
      return [{ url: cdnUrl, type: 'video', filename: shortcode ? `reel_${shortcode}` : null }];
    }

    // Fall back to API lookup via background script
    const shortcode = extractShortcode(pathname);
    if (shortcode) {
      return [{ type: 'video', filename: shortcode ? `reel_${shortcode}` : null, shortcode, needsVideoLookup: true }];
    }
  }

  // Fall back to resolveAll
  return [];
}

function collectMediaFromContainer(container, shortcode) {
  const items = [];
  let index = 1;

  container.querySelectorAll('img[src*="cdninstagram.com"]').forEach((img) => {
    const url = upgradeImageUrl(img.src, img);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    }
  });

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
        items.push({
          url: src,
          type: 'video',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        });
        index++;
      }
    } else if (src && src.startsWith('blob:')) {
      // blob: URL — try to extract real CDN URL from page scripts
      const cdnUrl = extractVideoUrlFromScripts(getScriptTexts());
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
        items.push({
          type: 'video',
          filename: shortcode ? `reel_${shortcode}` : null,
          shortcode,
          needsVideoLookup: true,
        });
        index++;
      }
    }
  });

  return { items, index };
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
  // DOM only renders ~2 slides at a time). Prefer an ancestor permalink of the
  // clicked target (grid thumbnails wrap their own /p/ link) before scanning the
  // container, so a shared-row container can't resolve to a sibling post.
  const shortcode = urlShortcode
    || shortcodeFromContainer(ancestorHrefs(target))
    || shortcodeFromContainer(Array.from(post.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
  const { items, index: nextIndex } = collectMediaFromContainer(post, shortcode);
  let index = nextIndex;

  // If DOM only found one item, check webRequest captures for more
  if (items.length <= 1) {
    const captured = await getCapturedMedia();
    const igMedia = captured
      .filter((c) => c.url.includes('cdninstagram.com') && c.type === 'image')
      .slice(-10);

    igMedia.forEach((c) => {
      if (!items.some((i) => i.url === c.url)) {
        items.push({
          url: c.url,
          type: 'image',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        });
        index++;
      }
    });
  }

  return {
    items: items.length > 0 ? items : resolveSingle(target?.src || '', target, pathname),
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
