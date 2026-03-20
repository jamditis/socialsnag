'use strict';

import { ALLOWED_DOMAINS } from './platforms/common.js';

const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
const MENU_DOWNLOAD_ALL = 'socialsnag-download-all';

// Supported platform URL patterns for context menu visibility
const SUPPORTED_URL_PATTERNS = [
  '*://*.instagram.com/*',
  '*://*.twitter.com/*',
  '*://*.x.com/*',
  '*://*.facebook.com/*',
  '*://*.bsky.app/*',
];

// CDN patterns for core platforms only (webRequest monitoring)
const CDN_PATTERNS = [
  '*://*.cdninstagram.com/*',
  '*://*.twimg.com/*',
  '*://*.fbcdn.net/*',
  '*://cdn.bsky.app/*',
  '*://video.bsky.app/*',
];

// --- Pure functions (exported for testing) ---

// Detect the platform from a tab URL (core platforms only)
export function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('bsky.app')) return 'bluesky';
  return null;
}

// Guess file extension
export function guessExtension(url, type) {
  if (type === 'video') return '.mp4';
  try {
    const u = new URL(url);
    const format = u.searchParams.get('format');
    if (format) return `.${format}`;
    const path = u.pathname;
    const match = path.match(/\.(jpg|jpeg|png|webp|gif|mp4|mov)(\?|$)/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch (e) { /* ignore */ }
  return '.jpg';
}

// Validate a download URL against HTTPS + domain allowlist
export function validateDownloadUrl(url) {
  if (!url) return { valid: false, reason: 'empty URL' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { valid: false, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'non-HTTPS URL' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    return { valid: false, reason: `untrusted domain: ${parsed.hostname}` };
  }

  return { valid: true };
}

// Build sanitized download path
export function sanitizeDownloadPath(rawFilename, platform, ext, downloadPath) {
  const filename = rawFilename
    .replace(/^[A-Za-z]:/, '')
    .replace(/\.\.[/\\]/g, '')
    .replace(/(^|[/\\])\.\.[/\\]?/g, '$1')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const folder = (downloadPath || 'SocialSnag/{platform}')
    .replace(/\{platform\}/g, platform)
    .replace(/^[A-Za-z]:/, '')
    .replace(/\.\.[/\\]/g, '')
    .replace(/(^|[/\\])\.\.[/\\]?/g, '$1')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_');
  const normalizedFolder = folder.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  return normalizedFolder + '/' + filename + ext;
}

// --- Browser wiring (not exported) ---

// Register context menu items on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_DOWNLOAD_SINGLE,
    title: 'SocialSnag: Download this (HD)',
    contexts: ['page', 'image', 'video', 'link'],
    documentUrlPatterns: SUPPORTED_URL_PATTERNS,
  });
  chrome.contextMenus.create({
    id: MENU_DOWNLOAD_ALL,
    title: 'SocialSnag: Download all from post',
    contexts: ['page', 'image', 'video', 'link'],
    documentUrlPatterns: SUPPORTED_URL_PATTERNS,
  });
});

// On startup, check if advanced mode is enabled and register webRequest if so
chrome.runtime.onStartup.addListener(initAdvancedMode);
chrome.runtime.onInstalled.addListener(initAdvancedMode);

async function initAdvancedMode() {
  const { advancedMode } = await chrome.storage.sync.get({ advancedMode: false });
  if (!advancedMode) return;

  const hasPermission = await chrome.permissions.contains({ permissions: ['webRequest'] });
  if (hasPermission) {
    registerWebRequestListener();
  }
}

function registerWebRequestListener() {
  if (!chrome.webRequest) return;
  try {
    if (!chrome.webRequest.onCompleted.hasListener(handleWebRequestCompleted)) {
      chrome.webRequest.onCompleted.addListener(
        handleWebRequestCompleted,
        { urls: CDN_PATTERNS, types: ['image', 'media', 'xmlhttprequest'] }
      );
    }
  } catch (e) {
    console.error('SocialSnag: failed to register webRequest listener:', e);
  }
}

function unregisterWebRequestListener() {
  if (!chrome.webRequest || !chrome.webRequest.onCompleted) return;
  try {
    if (chrome.webRequest.onCompleted.hasListener(handleWebRequestCompleted)) {
      chrome.webRequest.onCompleted.removeListener(handleWebRequestCompleted);
    }
  } catch (e) {
    console.error('SocialSnag: failed to unregister webRequest listener:', e);
  }
}

async function handleWebRequestCompleted(details) {
  if (details.tabId < 0) return;
  const key = `captured_${details.tabId}`;
  const { [key]: existing } = await chrome.storage.session.get(key);
  const urls = existing || [];
  urls.push({
    url: details.url,
    type: details.type,
    timestamp: Date.now(),
  });
  // Keep last 50 per tab
  if (urls.length > 50) urls.splice(0, urls.length - 50);
  await chrome.storage.session.set({ [key]: urls });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const type = info.menuItemId === MENU_DOWNLOAD_SINGLE ? 'single' : 'all';

  const platform = detectPlatform(tab.url);
  if (!platform) {
    showNotification('SocialSnag does not support this site.');
    return;
  }

  const platformSettings = await chrome.storage.sync.get({
    [`platform_${platform}`]: true,
    showNotifications: true,
  });
  if (!platformSettings[`platform_${platform}`]) return;

  try {
    // Try API-based video resolution FIRST (works without content script)
    const pageUrl = info.pageUrl || tab.url;
    const apiResult = await resolveViaApi(platform, pageUrl);
    let response;

    if (apiResult) {
      // API found a video — use it directly
      response = { urls: [apiResult], platform };
    } else {
      // No video via API — use content script for images
      try {
        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'resolve',
          type: type,
          srcUrl: info.srcUrl || '',
          pageUrl: pageUrl,
        });
      } catch (sendErr) {
        console.warn('SocialSnag: content script unavailable:', sendErr.message);
        // Try injecting content script on demand
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [`platforms/${platform}.js`],
          });
          await new Promise((r) => setTimeout(r, 150));
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'resolve',
            type: type,
            srcUrl: info.srcUrl || '',
            pageUrl: pageUrl,
          });
        } catch (injectErr) {
          showNotification('SocialSnag: could not connect to page. Try refreshing.');
          return;
        }
      }
    }

    if (!response || !response.urls || response.urls.length === 0) {
      showNotification('Could not find downloadable media on this element.');
      return;
    }

    let count = 0;
    for (const item of response.urls) {
      const downloadId = await downloadMedia(item, response.platform);
      if (downloadId) {
        await recordDownload(item, response.platform, downloadId);
        count++;
      }
    }

    if (count > 0) {
      if (platformSettings.showNotifications) {
        const label = count === 1 ? '1 file' : `${count} files`;
        showNotification(`Downloaded ${label} from ${response.platform}.`);
      }
    } else {
      console.warn('SocialSnag: all download attempts failed for', response.urls);
      if (platformSettings.showNotifications) {
        showNotification('SocialSnag: download failed. Check the browser console for details.');
      }
    }
  } catch (error) {
    console.error('SocialSnag error:', error);
    showNotification('SocialSnag: No supported media found here.');
  }
});

// --- Background-only fallback resolver (no content script needed) ---

async function resolveViaApi(platform, pageUrl) {
  if (platform === 'twitter') {
    const match = pageUrl.match(/\/status\/(\d+)/);
    if (match) {
      const tweetId = match[1];
      const videoUrl = await resolveTwitterVideo(tweetId);
      if (videoUrl) {
        return { url: videoUrl, type: 'video', filename: `tweet_${tweetId}`, needsVideoLookup: false };
      }
    }
  }

  if (platform === 'instagram') {
    const match = pageUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (match) {
      const shortcode = match[2];
      const videoUrl = await resolveInstagramVideo(shortcode);
      if (videoUrl) {
        return { url: videoUrl, type: 'video', filename: `reel_${shortcode}`, needsVideoLookup: false };
      }
    }
  }

  return null;
}

// --- API-based video resolvers ---

async function resolveTwitterVideo(tweetId) {
  try {
    const resp = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`
    );
    if (!resp.ok) {
      console.warn('SocialSnag: syndication API returned', resp.status);
      return null;
    }
    const data = await resp.json();

    // Find video media in mediaDetails
    const media = data.mediaDetails || [];
    const videoMedia = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
    if (!videoMedia?.video_info?.variants) return null;

    // Pick the highest bitrate MP4 variant
    const mp4s = videoMedia.video_info.variants
      .filter((v) => v.content_type === 'video/mp4' && v.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (mp4s.length > 0) {
      return mp4s[0].url;
    }
    console.warn('SocialSnag: no MP4 variants in syndication response');
    return null;
  } catch (e) {
    console.error('SocialSnag: Twitter video API failed:', e);
    return null;
  }
}

function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const char of shortcode) {
    id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
  }
  return id.toString();
}

async function resolveInstagramVideo(shortcode) {
  try {
    const mediaId = shortcodeToMediaId(shortcode);

    const resp = await fetch(
      `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
      {
        headers: {
          'x-ig-app-id': '936619743392459',
        },
        credentials: 'include',
      }
    );
    if (!resp.ok) {
      console.warn('SocialSnag: Instagram API returned', resp.status);
      return null;
    }
    const data = await resp.json();

    const items = data.items || [];
    if (items.length === 0) return null;

    const media = items[0];

    // Direct video
    if (media.video_versions?.length > 0) {
      // Sort by width (largest first) and return best quality
      const best = media.video_versions.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      return best.url;
    }

    // Carousel: find first video in carousel_media
    const carouselMedia = media.carousel_media || [];
    for (const cm of carouselMedia) {
      if (cm.video_versions?.length > 0) {
        const best = cm.video_versions.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        return best.url;
      }
    }

    return null;
  } catch (e) {
    console.error('SocialSnag: Instagram video API failed:', e);
    return null;
  }
}

// Validate and download a single media item
async function downloadMedia(item, platform) {
  // Handle API-based video lookups
  if (item.needsVideoLookup) {
    let resolvedUrl = null;

    if (item.tweetId) {
      resolvedUrl = await resolveTwitterVideo(item.tweetId);
    } else if (item.shortcode) {
      resolvedUrl = await resolveInstagramVideo(item.shortcode);
    }

    if (!resolvedUrl) {
      console.warn('SocialSnag: video API lookup returned no URL');
      return null;
    }

    item = { ...item, url: resolvedUrl, needsVideoLookup: false };
  }

  const validation = validateDownloadUrl(item.url);
  if (!validation.valid) {
    console.warn(`SocialSnag: rejected ${validation.reason}`);
    return null;
  }

  const { downloadPath } = await chrome.storage.sync.get({ downloadPath: 'SocialSnag/{platform}' });
  const ext = guessExtension(item.url, item.type);
  const rawFilename = item.filename || `${Date.now()}`;
  const path = sanitizeDownloadPath(rawFilename, platform, ext, downloadPath);

  let downloadUrl = item.url;

  if (platform === 'tiktok') {
    try {
      const response = await fetch(item.url, {
        headers: { 'Referer': 'https://www.tiktok.com/' },
      });
      const blob = await response.blob();
      downloadUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.error('SocialSnag: TikTok fetch failed, trying direct:', e);
    }
  }

  try {
    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: path,
      conflictAction: 'uniquify',
    });
    return downloadId;
  } catch (e) {
    console.error('SocialSnag: download failed:', e);
    return null;
  }
}

// Record a successful download to history
async function recordDownload(item, platform, downloadId) {
  const rawFilename = item.filename || `${Date.now()}`;
  const filename = rawFilename
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const entry = {
    filename: filename,
    platform: platform,
    type: item.type || 'image',
    timestamp: Date.now(),
    downloadId: downloadId,
  };

  const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });
  downloadHistory.push(entry);

  // Prune to 50 entries max
  if (downloadHistory.length > 50) {
    downloadHistory.splice(0, downloadHistory.length - 50);
  }

  await chrome.storage.local.set({ downloadHistory });
}

// Show a browser notification
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialSnag',
    message: message,
  });
}

// Clean up captured media when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `captured_${tabId}`;
  await chrome.storage.session.remove(key);
});

// Respond to content script requests for captured media
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message.action === 'getCapturedMedia' && sender.tab) {
    const key = `captured_${sender.tab.id}`;
    chrome.storage.session.get(key).then((result) => {
      sendResponse({ urls: result[key] || [] });
    });
    return true;
  }

  if (message.action === 'enableAdvancedMode') {
    registerWebRequestListener();
    return;
  }

  if (message.action === 'disableAdvancedMode') {
    unregisterWebRequestListener();
    return;
  }
});
