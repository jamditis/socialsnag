// SocialSnag common utilities

// Allowlist of CDN domains we trust for downloads
export const ALLOWED_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
];

export function isAllowedDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => {
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch (e) {
    return false;
  }
}

export function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

export function sanitizeFilename(name) {
  if (!name) return null;
  return name
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

export function extractId(url, pattern) {
  const match = url.match(pattern);
  return match ? match[1] : null;
}

export function findPostContainer(element, selectors) {
  let el = element;
  while (el && el !== document.body) {
    for (const selector of selectors) {
      if (el.matches(selector)) return el;
    }
    el = el.parentElement;
  }
  return null;
}

export function collectMediaInContainer(container) {
  const items = [];
  if (!container) return items;

  container.querySelectorAll('img').forEach((img) => {
    const src = img.src || img.dataset.src || '';
    if (src && !src.startsWith('data:')) {
      items.push({ url: src, type: 'image', element: img });
    }
  });

  container.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src || '';
    if (src && !src.startsWith('blob:')) {
      items.push({ url: src, type: 'video', element: video });
    }
  });

  return items;
}

export function findNearestMedia(element) {
  if (!element) return null;

  // Check if the target itself is media
  if (element.tagName === 'IMG') return element;
  if (element.tagName === 'VIDEO') return element;

  // Check children (click on overlay div containing an img)
  const img = element.querySelector('img');
  if (img) return img;
  const video = element.querySelector('video');
  if (video) return video;

  // Walk up and check siblings/parent containers
  let el = element;
  for (let i = 0; i < 5 && el && el !== document.body; i++) {
    el = el.parentElement;
    if (!el) break;
    const nearImg = el.querySelector('img');
    if (nearImg && nearImg.src && !nearImg.src.startsWith('data:')) return nearImg;
    const nearVideo = el.querySelector('video');
    if (nearVideo) return nearVideo;
  }

  return null;
}

export async function getCapturedMedia() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getCapturedMedia' }, (response) => {
      resolve(response?.urls || []);
    });
  });
}
