// SocialSnag — Instagram content script

import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeImageUrl(url, imgElement) {
  if (!url || !url.includes('cdninstagram.com')) return null;

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

export function extractVideoUrlFromScripts(scriptTexts) {
  for (const text of scriptTexts) {
    if (!text) continue;

    // Match "video_url":"https://...cdninstagram.com/..."
    if (text.includes('video_url')) {
      const match = text.match(/"video_url":"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }
    }

    // Match "video_versions":[{"url":"https://..."}]
    if (text.includes('video_versions')) {
      const match = text.match(/"video_versions"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
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

  container.querySelectorAll('video').forEach((video) => {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      items.push({
        url: src,
        type: 'video',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    } else if (src && src.startsWith('blob:')) {
      // blob: URL — try to extract real CDN URL from page scripts
      const scripts = document.querySelectorAll('script');
      const scriptTexts = Array.from(scripts).map((s) => s.textContent);
      const cdnUrl = extractVideoUrlFromScripts(scriptTexts);
      if (cdnUrl) {
        items.push({
          url: cdnUrl,
          type: 'video',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
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

async function resolveAll(target, pathname) {
  // Try JSON extraction first for carousel data
  const jsonItems = extractFromPageJson(pathname);
  if (jsonItems.length > 0) return jsonItems;

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

  if (!post) return resolveSingle(target?.src || '', target, pathname);

  const shortcode = extractShortcode(pathname);
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
          sendResponse({ urls: urls || [], platform: 'instagram' });
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
