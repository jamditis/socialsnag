// SocialSnag — Facebook content script

import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

// --- Pure functions (exported for testing) ---

export function upgradeUrl(url) {
  if (!url || !url.includes('fbcdn.net')) return null;
  // Try removing size constraints from path
  let upgraded = url.replace(/\/[sp]\d+x\d+\//, '/');
  return upgraded;
}

export function extractPhotoId(url) {
  if (!url) return null;
  const match = url.match(/\/(\d{10,})/);
  return match ? match[1] : null;
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

// --- Browser wiring (not exported) ---

function findVideoUrl(target) {
  const container = target?.closest('[role="article"]') || target?.parentElement;
  if (!container) return null;

  const video = container.querySelector('video');
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) return src;
  }

  // Try to find playable_url in page scripts
  const scripts = document.querySelectorAll('script');
  const scriptTexts = Array.from(scripts).map((s) => s.textContent);
  return extractVideoUrlFromScripts(scriptTexts);
}

function resolveSingle(srcUrl, target) {
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

  const videoUrl = findVideoUrl(target);
  if (videoUrl) {
    return [{ url: videoUrl, type: 'video', filename: null }];
  }

  return [];
}

async function resolveAll(target) {
  const post = findPostContainer(target, [
    '[role="article"]',
    '[data-pagelet*="FeedUnit"]',
    '[data-pagelet*="ProfileTimeline"]',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  let index = 1;

  post.querySelectorAll('img[src*="fbcdn.net"]').forEach((img) => {
    const url = upgradeUrl(img.src);
    if (url) {
      // Skip tiny images (profile pics, reaction icons)
      if (img.width > 50 || img.naturalWidth > 50 || !img.width) {
        const id = extractPhotoId(img.src);
        items.push({
          url,
          type: 'image',
          filename: id ? `photo_${id}_${index}` : null,
        });
        index++;
      }
    }
  });

  // Fall back to webRequest captures if DOM is sparse
  if (items.length === 0) {
    const captured = await getCapturedMedia();
    const fbImages = captured
      .filter((c) => c.url.includes('fbcdn.net') && c.type === 'image')
      .slice(-5);

    fbImages.forEach((c) => {
      items.push({
        url: c.url,
        type: 'image',
        filename: `photo_${index}`,
      });
      index++;
    });
  }

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
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
