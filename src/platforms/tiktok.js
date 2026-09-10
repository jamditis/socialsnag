// SocialSnag — TikTok content script

import {
  getCapturedMedia,
  hostMatches,
  withItemMeta,
} from './common.js';

const TIKTOK_CDN_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com'];

function itemStructFromJson(jsonText) {
  if (typeof jsonText !== 'string' || jsonText === '') return null;
  try {
    const data = JSON.parse(jsonText);
    return data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct || null;
  } catch {
    return null;
  }
}

function identity(item, pathname) {
  return {
    postId: item?.id || extractPostId(pathname),
    username: item?.author?.uniqueId || extractUsername(pathname),
  };
}

function firstString(value) {
  if (typeof value === 'string' && value !== '') return value;
  if (!Array.isArray(value)) return null;
  return value.find((entry) => typeof entry === 'string' && entry !== '') || null;
}

// --- Pure functions (exported for testing) ---

export function extractPostId(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/\/(?:video|photo)\/(\d+)(?:\/|$)/);
  return match ? match[1] : null;
}

// Kept as the public name used by the original delivery checklist.
export function extractVideoId(pathname) {
  return extractPostId(pathname);
}

export function extractUsername(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/^\/@([^/]+)\/(?:video|photo)\/\d+(?:\/|$)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function extractFromRehydrationJson(jsonText, pathname = '') {
  const item = itemStructFromJson(jsonText);
  if (!item?.video) return null;

  const url = firstString(item.video.playAddr) || firstString(item.video.downloadAddr);
  if (!url) return null;

  const mediaIdentity = identity(item, pathname);
  return withItemMeta({
    url,
    type: 'video',
    filename: mediaIdentity.postId ? `video_${mediaIdentity.postId}` : null,
  }, mediaIdentity);
}

export function extractPhotoPosts(jsonText, pathname = '') {
  const item = itemStructFromJson(jsonText);
  const images = item?.imagePost?.images;
  if (!Array.isArray(images)) return [];

  const mediaIdentity = identity(item, pathname);
  return images.flatMap((image, index) => {
    const source = image?.imageURL;
    const url = firstString(source?.urlList) || firstString(source);
    if (!url) return [];
    return [withItemMeta({
      url,
      type: 'image',
      filename: mediaIdentity.postId ? `photo_${mediaIdentity.postId}_${index + 1}` : null,
    }, mediaIdentity)];
  });
}

export function newestCapturedVideo(captures, pathname = '') {
  if (!Array.isArray(captures)) return null;
  const videos = captures
    .filter((capture) => capture?.type === 'media'
      && TIKTOK_CDN_HOSTS.some((host) => hostMatches(capture.url, host)))
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  if (videos.length === 0) return null;

  const mediaIdentity = {
    postId: extractPostId(pathname),
    username: extractUsername(pathname),
  };
  return withItemMeta({
    url: videos[0].url,
    type: 'video',
    filename: mediaIdentity.postId ? `video_${mediaIdentity.postId}` : null,
  }, mediaIdentity);
}

export async function resolvePage(
  root = document,
  pathname = globalThis.window?.location?.pathname || '',
  loadCapturedMedia = getCapturedMedia,
) {
  const jsonText = root.getElementById?.('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '';

  const video = extractFromRehydrationJson(jsonText, pathname);
  if (video) return [video];

  const captured = newestCapturedVideo(await loadCapturedMedia(), pathname);
  if (captured) return [captured];

  return extractPhotoPosts(jsonText, pathname);
}

// --- Browser wiring (not exported) ---

function initContentScript() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'resolve') return;
    resolvePage()
      .then((urls) => sendResponse({ urls, platform: 'tiktok' }))
      .catch((error) => {
        console.error('SocialSnag TikTok error:', error);
        sendResponse({ urls: [], platform: 'tiktok' });
      });
    return true;
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
