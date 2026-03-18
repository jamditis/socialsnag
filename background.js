'use strict';

// Context menu item IDs
const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
const MENU_DOWNLOAD_ALL = 'socialsnag-download-all';

// Per-tab captured media from passive webRequest monitoring
const capturedMedia = new Map();

// CDN URL patterns to monitor passively
const CDN_PATTERNS = [
  '*://*.cdninstagram.com/*',
  '*://*.twimg.com/*',
  '*://*.fbcdn.net/*',
  '*://*.licdn.com/*',
  '*://*.tiktokcdn.com/*',
  '*://*.tiktokcdn-us.com/*',
];

// Register context menu items on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_DOWNLOAD_SINGLE,
    title: 'SocialSnag: Download this (HD)',
    contexts: ['image', 'video'],
  });
  chrome.contextMenus.create({
    id: MENU_DOWNLOAD_ALL,
    title: 'SocialSnag: Download all from post',
    contexts: ['image', 'video'],
  });
});

// Detect the platform from a tab URL
function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('youtube.com')) return 'youtube';
  if (url.includes('linkedin.com')) return 'linkedin';
  if (url.includes('tiktok.com')) return 'tiktok';
  return null;
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const type = info.menuItemId === MENU_DOWNLOAD_SINGLE ? 'single' : 'all';

  const platform = detectPlatform(tab.url);
  if (!platform) {
    showNotification('SocialSnag does not support this site.');
    return;
  }

  const platformSettings = await chrome.storage.sync.get({ [`platform_${platform}`]: true, showNotifications: true });
  if (!platformSettings[`platform_${platform}`]) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'resolve',
      type: type,
      srcUrl: info.srcUrl || '',
      pageUrl: info.pageUrl || tab.url,
    });

    if (!response || !response.urls || response.urls.length === 0) {
      showNotification('Could not find downloadable media on this element.');
      return;
    }

    let count = 0;

    for (const item of response.urls) {
      await downloadMedia(item, response.platform);
      count++;
    }

    if (platformSettings.showNotifications) {
      const label = count === 1 ? '1 file' : `${count} files`;
      showNotification(`Downloaded ${label} from ${response.platform}.`);
    }
  } catch (error) {
    console.error('SocialSnag error:', error);
    showNotification('SocialSnag: No supported media found here.');
  }
});

// Download a single media item, with TikTok blob workaround for Referer requirement
async function downloadMedia(item, platform) {
  const ext = guessExtension(item.url, item.type);
  const filename = item.filename || `${Date.now()}`;
  const path = `SocialSnag/${platform}/${filename}${ext}`;

  let downloadUrl = item.url;

  if (platform === 'tiktok') {
    try {
      const response = await fetch(item.url, {
        headers: { 'Referer': 'https://www.tiktok.com/' },
      });
      const blob = await response.blob();
      downloadUrl = URL.createObjectURL(blob);
    } catch (e) {
      console.error('SocialSnag: TikTok fetch failed, trying direct download:', e);
    }
  }

  return chrome.downloads.download({
    url: downloadUrl,
    filename: path,
    conflictAction: 'uniquify',
  });
}

// Guess a file extension from URL and media type
function guessExtension(url, type) {
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

// Show a browser notification
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialSnag',
    message: message,
  });
}

// Passively capture media URLs from CDN requests as they complete
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!capturedMedia.has(details.tabId)) {
      capturedMedia.set(details.tabId, []);
    }
    capturedMedia.get(details.tabId).push({
      url: details.url,
      type: details.type,
      timestamp: Date.now(),
    });
  },
  { urls: CDN_PATTERNS, types: ['image', 'media', 'xmlhttprequest'] }
);

// Clean up captured media when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedMedia.delete(tabId);
});

// Respond to content script requests for captured media
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCapturedMedia' && sender.tab) {
    const urls = capturedMedia.get(sender.tab.id) || [];
    sendResponse({ urls });
    return true;
  }
});
