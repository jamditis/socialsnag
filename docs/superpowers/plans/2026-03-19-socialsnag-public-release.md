# SocialSnag public release implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SocialSnag as a public GitHub repo with popup UI, security hardening, and Chrome Web Store listing assets.

**Architecture:** Manifest V3 Chrome extension. Background service worker handles context menu clicks and downloads. Per-platform content scripts resolve media URLs from page DOM. Popup shows download history. Options page controls platform toggles and advanced mode.

**Tech Stack:** Vanilla JS (no build step), Chrome Extension APIs (MV3), SVG icon rendered to PNG via Python/Pillow.

**Spec:** `docs/superpowers/specs/2026-03-19-socialsnag-public-release-design.md`

---

## File map

### New files
| File | Responsibility |
|------|---------------|
| `popup.html` | Popup markup — header, platform badges, download history list, footer |
| `popup.js` | Popup logic — read storage, render history, handle clicks |
| `popup.css` | Popup dark theme styles |
| `options.css` | Options page styles (extracted from inline) |
| `icons/icon.svg` | Source vector icon |
| `.gitignore` | Standard ignores for extension dev |
| `LICENSE` | MIT license |
| `README.md` | Project docs |
| `PRIVACY.md` | Privacy policy |
| `CHANGELOG.md` | Release history |
| `.github/copilot-instructions.md` | Copilot review context |
| `store/description.txt` | Chrome Web Store listing copy |
| `store/screenshot-guide.md` | What each of the 5 CWS screenshots should show |

### Modified files
| File | What changes |
|------|-------------|
| `manifest.json` | Permissions, host_permissions, optional_*, popup, options_ui, version, content_scripts |
| `background.js` | Security (URL validation, sender check, filename sanitize), download history, webRequest guard, capturedMedia to session storage, platform scoping |
| `options.html` | External CSS, disclaimer, advanced mode toggle, privacy link, YouTube removed, LinkedIn/TikTok grayed |
| `options.js` | Advanced mode toggle with permission request, platform array update, dynamic permission logic |
| `platforms/common.js` | Add `isAllowedDomain()` and `sanitizeFilename()` helpers |
| `icons/icon16.png` | Regenerated from SVG |
| `icons/icon48.png` | Regenerated from SVG |
| `icons/icon128.png` | Regenerated from SVG |

### Unchanged files
| File | Why unchanged |
|------|-------------|
| `platforms/instagram.js` | No changes needed for security/scoping |
| `platforms/twitter.js` | No changes needed |
| `platforms/facebook.js` | No changes needed |
| `platforms/linkedin.js` | Stays in repo, just not in manifest |
| `platforms/tiktok.js` | Stays in repo, just not in manifest |
| `platforms/youtube.js` | Stays in repo, just not in manifest |

---

## Task 1: Security hardening — common.js helpers

**Files:**
- Modify: `platforms/common.js` (add `isAllowedDomain()`, `sanitizeFilename()`)

- [ ] **Step 1: Add URL domain validation helper to common.js**

Add to the `SocialSnag` object in `platforms/common.js`, after the `extractId` method:

```javascript
// Allowlist of CDN domains we trust for downloads
_ALLOWED_DOMAINS: [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
  'media.licdn.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
],

isAllowedDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return SocialSnag._ALLOWED_DOMAINS.some((d) => hostname.endsWith(d));
  } catch (e) {
    return false;
  }
},

isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch (e) {
    return false;
  }
},

sanitizeFilename(name) {
  if (!name) return null;
  return name
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
},
```

- [ ] **Step 2: Verify common.js loads without errors**

Load the extension in `chrome://extensions` developer mode. Open any Instagram page. Open DevTools console — no errors from common.js.

- [ ] **Step 3: Commit**

```bash
git add platforms/common.js
git commit -m "feat: add URL validation and filename sanitization helpers"
```

---

## Task 2: Security hardening — background.js

**Files:**
- Modify: `background.js` (sender validation, URL validation before download, filename sanitize)

- [ ] **Step 1: Add sender.id validation to onMessage handler**

In `background.js`, update the `chrome.runtime.onMessage.addListener` block (currently line 164) to check sender:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.action === 'getCapturedMedia' && sender.tab) {
    const urls = capturedMedia.get(sender.tab.id) || [];
    sendResponse({ urls });
    return true;
  }
});
```

- [ ] **Step 2: Add URL validation and filename sanitization to downloadMedia**

Update the `downloadMedia` function (currently line 92) to validate before downloading:

```javascript
async function downloadMedia(item, platform) {
  if (!SocialSnag || !item.url) return;

  // Security: validate URL domain and protocol
  try {
    const u = new URL(item.url);
    if (u.protocol !== 'https:') {
      console.warn('SocialSnag: rejected non-HTTPS URL:', item.url);
      return;
    }
    const ALLOWED_DOMAINS = [
      'cdninstagram.com', 'pbs.twimg.com', 'video.twimg.com',
      'fbcdn.net', 'media.licdn.com', 'tiktokcdn.com', 'tiktokcdn-us.com',
    ];
    if (!ALLOWED_DOMAINS.some((d) => u.hostname.endsWith(d))) {
      console.warn('SocialSnag: rejected URL from untrusted domain:', u.hostname);
      return;
    }
  } catch (e) {
    console.warn('SocialSnag: rejected invalid URL:', item.url);
    return;
  }

  const ext = guessExtension(item.url, item.type);
  const rawFilename = item.filename || `${Date.now()}`;
  // Security: sanitize filename
  const filename = rawFilename.replace(/\.\.[/\\]/g, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
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
```

Note: The background service worker doesn't have access to the `SocialSnag` object (that's in content scripts). The URL validation is duplicated here intentionally — defense in depth. The background is the last gate before the downloads API.

- [ ] **Step 3: Verify by right-clicking an Instagram image and downloading**

Load extension, go to Instagram, right-click an image, select "SocialSnag: Download this (HD)". File should download. Check DevTools for any console warnings about rejected URLs.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: add sender validation, URL allowlist, and filename sanitization"
```

---

## Task 3: Manifest + permission refactor

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Rewrite manifest.json**

Replace the entire manifest with:

```json
{
  "manifest_version": 3,
  "name": "SocialSnag",
  "version": "1.0.0",
  "description": "Right-click to download full-resolution media from social media.",
  "author": "Joe Amditis",
  "homepage_url": "https://github.com/jamditis/socialsnag",
  "minimum_chrome_version": "116",
  "permissions": [
    "contextMenus",
    "downloads",
    "activeTab",
    "storage",
    "notifications",
    "scripting"
  ],
  "optional_permissions": [
    "webRequest"
  ],
  "host_permissions": [
    "*://*.instagram.com/*",
    "*://*.cdninstagram.com/*",
    "*://*.twitter.com/*",
    "*://*.x.com/*",
    "*://*.twimg.com/*",
    "*://*.facebook.com/*",
    "*://*.fbcdn.net/*"
  ],
  "optional_host_permissions": [
    "*://*.linkedin.com/*",
    "*://*.licdn.com/*",
    "*://*.tiktok.com/*",
    "*://*.tiktokcdn.com/*",
    "*://*.tiktokcdn-us.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://*.instagram.com/*"],
      "js": ["platforms/common.js", "platforms/instagram.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://*.twitter.com/*", "*://*.x.com/*"],
      "js": ["platforms/common.js", "platforms/twitter.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://*.facebook.com/*"],
      "js": ["platforms/common.js", "platforms/facebook.js"],
      "run_at": "document_idle"
    }
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "SocialSnag"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Key changes from current manifest:
- YouTube, LinkedIn, TikTok removed from `content_scripts`
- YouTube removed from `host_permissions` entirely
- LinkedIn/TikTok moved to `optional_host_permissions`
- `webRequest` moved to `optional_permissions`
- Added `homepage_url`, `minimum_chrome_version`
- `options_page` replaced with `options_ui`
- `action` now includes `default_popup`
- Version bumped to `1.0.0`

- [ ] **Step 2: Verify extension loads in chrome://extensions**

Reload the extension. It should load without errors. The popup won't work yet (popup.html doesn't exist), but the context menu should still function on Instagram/Twitter/Facebook.

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: refactor permissions for CWS, drop YouTube, add popup + optional permissions"
```

---

## Task 4: Background.js — webRequest guard + session storage + download history + context menu scoping

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Rewrite background.js**

This is a significant rewrite. Replace the entire file with the updated version that:
- Moves `capturedMedia` from in-memory Map to `chrome.storage.session`
- Guards all `webRequest` usage behind permission check
- Adds `documentUrlPatterns` to context menu items
- Adds download history recording
- Updates `detectPlatform()` to only return core platforms
- Removes LinkedIn/TikTok from `CDN_PATTERNS`
- Adds `recordDownload()` helper for history

```javascript
'use strict';

const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
const MENU_DOWNLOAD_ALL = 'socialsnag-download-all';

// Supported platform URL patterns for context menu visibility
const SUPPORTED_URL_PATTERNS = [
  '*://*.instagram.com/*',
  '*://*.twitter.com/*',
  '*://*.x.com/*',
  '*://*.facebook.com/*',
];

// CDN patterns for core platforms only (webRequest monitoring)
const CDN_PATTERNS = [
  '*://*.cdninstagram.com/*',
  '*://*.twimg.com/*',
  '*://*.fbcdn.net/*',
];

// Domain allowlist for download URL validation
const ALLOWED_DOWNLOAD_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
  'media.licdn.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
];

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
    chrome.webRequest.onCompleted.addListener(
      handleWebRequestCompleted,
      { urls: CDN_PATTERNS, types: ['image', 'media', 'xmlhttprequest'] }
    );
  } catch (e) {
    console.error('SocialSnag: failed to register webRequest listener:', e);
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

// Detect the platform from a tab URL (core platforms only)
function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
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

  const platformSettings = await chrome.storage.sync.get({
    [`platform_${platform}`]: true,
    showNotifications: true,
  });
  if (!platformSettings[`platform_${platform}`]) return;

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
      const downloadId = await downloadMedia(item, response.platform);
      if (downloadId) {
        await recordDownload(item, response.platform, downloadId);
        count++;
      }
    }

    if (platformSettings.showNotifications && count > 0) {
      const label = count === 1 ? '1 file' : `${count} files`;
      showNotification(`Downloaded ${label} from ${response.platform}.`);
    }
  } catch (error) {
    console.error('SocialSnag error:', error);
    showNotification('SocialSnag: No supported media found here.');
  }
});

// Validate and download a single media item
async function downloadMedia(item, platform) {
  if (!item.url) return null;

  // Validate URL protocol
  let parsed;
  try {
    parsed = new URL(item.url);
  } catch (e) {
    console.warn('SocialSnag: rejected invalid URL');
    return null;
  }

  if (parsed.protocol !== 'https:') {
    console.warn('SocialSnag: rejected non-HTTPS URL');
    return null;
  }

  // Validate URL domain
  if (!ALLOWED_DOWNLOAD_DOMAINS.some((d) => parsed.hostname.endsWith(d))) {
    console.warn('SocialSnag: rejected URL from untrusted domain:', parsed.hostname);
    return null;
  }

  const ext = guessExtension(item.url, item.type);
  const rawFilename = item.filename || `${Date.now()}`;
  const filename = rawFilename
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
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
  const entry = {
    url: item.url,
    filename: item.filename || `${Date.now()}`,
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

// Guess file extension
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
});
```

- [ ] **Step 2: Verify context menu works on Instagram, doesn't appear on google.com**

Reload extension. Go to google.com — right-click should NOT show SocialSnag menu items. Go to instagram.com — should show them. Download an image and verify it saves.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: rewrite background for CWS — session storage, webRequest guard, download history, scoped menus"
```

---

## Task 5: SVG icon design + PNG renders

**Files:**
- Create: `icons/icon.svg`
- Modify: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

- [ ] **Step 1: Create SVG icon**

Create `icons/icon.svg` — a downward arrow inside a rounded square frame. Blue (#3b82f6) arrow on transparent background. Clean geometric style, no text.

- [ ] **Step 2: Render PNGs from SVG**

Use Python + cairosvg or Pillow to render at 16, 48, 128px:

```bash
pip3 install --break-system-packages cairosvg 2>/dev/null
python3 -c "
import cairosvg
for size in [16, 48, 128]:
    cairosvg.svg2png(url='icons/icon.svg', write_to=f'icons/icon{size}.png', output_width=size, output_height=size)
print('Done')
"
```

If cairosvg is unavailable on ARM64, fall back to Inkscape or rsvg-convert:
```bash
for size in 16 48 128; do
  rsvg-convert -w $size -h $size icons/icon.svg -o icons/icon${size}.png
done
```

- [ ] **Step 3: Verify icons look correct at all sizes**

Open each PNG to confirm they're readable.

- [ ] **Step 4: Commit**

```bash
git add icons/
git commit -m "feat: design SVG icon and render PNGs at 16/48/128px"
```

---

## Task 6: Popup UI

**Files:**
- Create: `popup.html`, `popup.css`, `popup.js`

- [ ] **Step 1: Create popup.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 360px;
  min-height: 200px;
  background: #050a18;
  color: #e5e7eb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header img { width: 20px; height: 20px; }

.header h1 {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.header .version {
  font-size: 11px;
  color: #6b7280;
}

.platforms {
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.platform-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.platform-badge:hover {
  background: rgba(255,255,255,0.1);
}

.platform-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
}

.platform-badge.disabled .dot {
  background: #4b5563;
}

.platform-badge.disabled {
  opacity: 0.5;
}

.history-section {
  padding: 10px 16px 6px;
}

.history-section h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin-bottom: 8px;
}

.history-list {
  max-height: 280px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-item:hover {
  background: rgba(255,255,255,0.05);
}

.history-item .platform-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}

.history-item .platform-icon.instagram { background: linear-gradient(135deg, #f58529, #dd2a7b, #8134af); }
.history-item .platform-icon.twitter { background: #1d9bf0; }
.history-item .platform-icon.facebook { background: #1877f2; }

.history-item .details {
  flex: 1;
  min-width: 0;
}

.history-item .filename {
  color: #f9fafb;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item .meta {
  color: #6b7280;
  font-size: 11px;
}

.history-item .time {
  color: #6b7280;
  font-size: 11px;
  flex-shrink: 0;
}

.empty-state {
  text-align: center;
  padding: 30px 16px;
  color: #6b7280;
}

.empty-state p {
  font-size: 12px;
  line-height: 1.5;
}

.footer {
  display: flex;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.footer button {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 0;
}

.footer button:hover {
  color: #60a5fa;
}

.not-found {
  opacity: 0.5;
  text-decoration: line-through;
}
```

- [ ] **Step 2: Create popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="header">
    <div class="header-left">
      <img src="icons/icon48.png" alt="">
      <h1>SocialSnag</h1>
    </div>
    <span class="version">v1.0.0</span>
  </div>

  <div class="platforms" id="platforms"></div>

  <div class="history-section">
    <h2>Recent downloads</h2>
    <div class="history-list" id="history-list"></div>
  </div>

  <div class="footer">
    <button id="btn-settings">Settings</button>
    <button id="btn-clear">Clear history</button>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create popup.js**

```javascript
'use strict';

const CORE_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'twitter', label: 'Twitter/X' },
  { id: 'facebook', label: 'Facebook' },
];

// No emoji — use plain text abbreviations. The colored CSS background squares
// (.platform-icon.instagram etc.) provide the visual identity.
const PLATFORM_LABELS = {
  instagram: 'IG',
  twitter: 'X',
  facebook: 'FB',
};

document.addEventListener('DOMContentLoaded', async () => {
  await renderPlatforms();
  await renderHistory();

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    await chrome.storage.local.set({ downloadHistory: [] });
    renderHistory();
  });
});

async function renderPlatforms() {
  const container = document.getElementById('platforms');
  const defaults = {};
  CORE_PLATFORMS.forEach((p) => { defaults[`platform_${p.id}`] = true; });
  const settings = await chrome.storage.sync.get(defaults);

  container.textContent = '';
  CORE_PLATFORMS.forEach((p) => {
    const enabled = settings[`platform_${p.id}`];
    const badge = document.createElement('div');
    badge.className = `platform-badge${enabled ? '' : ' disabled'}`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    badge.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = p.label;
    badge.appendChild(label);

    badge.addEventListener('click', async () => {
      const newValue = !settings[`platform_${p.id}`];
      settings[`platform_${p.id}`] = newValue;
      await chrome.storage.sync.set({ [`platform_${p.id}`]: newValue });
      badge.className = `platform-badge${newValue ? '' : ' disabled'}`;
    });

    container.appendChild(badge);
  });
}

async function renderHistory() {
  const container = document.getElementById('history-list');
  const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });

  container.textContent = '';

  if (downloadHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'No downloads yet. Right-click an image or video on a supported site to get started.';
    empty.appendChild(p);
    container.appendChild(empty);
    return;
  }

  // Show most recent 20
  const recent = downloadHistory.slice(-20).reverse();

  recent.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.addEventListener('click', () => {
      chrome.downloads.show(entry.downloadId).catch(() => {
        item.classList.add('not-found');
      });
    });

    const icon = document.createElement('div');
    icon.className = `platform-icon ${entry.platform}`;
    icon.textContent = PLATFORM_LABELS[entry.platform] || '';
    item.appendChild(icon);

    const details = document.createElement('div');
    details.className = 'details';

    const filename = document.createElement('div');
    filename.className = 'filename';
    filename.textContent = entry.filename || 'unknown';
    details.appendChild(filename);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = entry.platform;
    details.appendChild(meta);

    item.appendChild(details);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = relativeTime(entry.timestamp);
    item.appendChild(time);

    container.appendChild(item);
  });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
```

Note: Uses `textContent` throughout — no `innerHTML`. Platform icons use Unicode characters to avoid needing image assets. `chrome.downloads.show()` is wrapped in a catch for stale entries.

- [ ] **Step 4: Verify popup works**

Reload extension. Click the SocialSnag icon in the toolbar. Popup should show with platform badges and empty history state. Download something, reopen popup — the entry should appear.

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: popup UI with platform badges and download history"
```

---

## Task 7: Options page updates

**Files:**
- Create: `options.css`
- Modify: `options.html`, `options.js`

- [ ] **Step 1: Extract styles to options.css**

Create `options.css` with the styles currently inline in `options.html` (the `<style>` block from lines 8-82). Add styles for the new sections (disclaimer, advanced mode, privacy link, grayed-out platforms).

- [ ] **Step 2: Update options.html**

Replace inline `<style>` with `<link rel="stylesheet" href="options.css">`. Remove YouTube checkbox. Add LinkedIn/TikTok as grayed-out with "developer mode" note. Add advanced mode section. Add copyright disclaimer. Add privacy policy link.

- [ ] **Step 3: Update options.js**

Change the `PLATFORMS` array to only include the 3 core platforms. Add advanced mode toggle logic that calls `chrome.permissions.request()` for webRequest permission and sends `enableAdvancedMode` message to background.

- [ ] **Step 4: Verify options page**

Reload extension. Open options (right-click extension icon > Options). Should show 3 platform toggles, advanced mode toggle, disclaimer, privacy link. YouTube should be gone. Toggle advanced mode on — should prompt for webRequest permission.

- [ ] **Step 5: Commit**

```bash
git add options.html options.css options.js
git commit -m "feat: update options page — external CSS, advanced mode, disclaimer, platform scoping"
```

---

## Task 8: Repository files

**Files:**
- Create: `.gitignore`, `LICENSE`, `PRIVACY.md`, `CHANGELOG.md`, `README.md`, `.github/copilot-instructions.md`

- [ ] **Step 1: Create .gitignore**

```
# OS
.DS_Store
Thumbs.db

# Editors
*.swp
*.swo
*~
.idea/
.vscode/

# Extension packaging
*.pem
*.crx
*.zip

# Dependencies (if any added later)
node_modules/
dist/

# Environment
.env
.env.local
```

- [ ] **Step 2: Create LICENSE**

MIT license, copyright 2026 Joe Amditis.

- [ ] **Step 3: Create PRIVACY.md**

Full privacy policy per spec section 8 — what's collected (local preferences + download history), what's not (no PII, no analytics, no tracking), where it's stored (locally via Chrome storage API), no third-party sharing, activeTab behavior, user control, contact info via GitHub issues.

- [ ] **Step 4: Create CHANGELOG.md**

```markdown
# Changelog

## 1.0.0 — 2026-03-19

Initial public release.

- Right-click context menu to download HD media from Instagram, Twitter/X, and Facebook
- Popup with download history
- Options page with platform toggles and advanced mode
- URL domain validation and filename sanitization
- Privacy-first: all data stored locally, nothing transmitted
```

- [ ] **Step 5: Create README.md**

Project overview, feature list, supported platforms, install instructions (Chrome Web Store link TBD + sideload instructions), screenshot placeholder, privacy note, contributing section, license.

- [ ] **Step 6: Create .github/copilot-instructions.md**

Architecture overview, message passing pattern, platform resolver pattern, URL upgrade pattern, and key review flags per spec section 7.

- [ ] **Step 7: Commit**

```bash
git add .gitignore LICENSE PRIVACY.md CHANGELOG.md README.md .github/copilot-instructions.md
git commit -m "docs: add LICENSE, README, privacy policy, changelog, gitignore, copilot instructions"
```

---

## Task 9: Push and make repo public

**Files:** None (git operations only)

- [ ] **Step 1: Push all commits**

```bash
git push origin master
```

- [ ] **Step 2: Make repo public**

```bash
gh repo edit jamditis/socialsnag --visibility public
```

- [ ] **Step 3: Add topics and description**

```bash
gh repo edit jamditis/socialsnag --description "Chrome extension for downloading HD media from social media via context menu"
gh api repos/jamditis/socialsnag/topics -X PUT -f "names[]=chrome-extension" -f "names[]=social-media" -f "names[]=media-downloader" -f "names[]=manifest-v3" -f "names[]=instagram" -f "names[]=twitter"
```

- [ ] **Step 4: Verify repo is public**

```bash
gh repo view jamditis/socialsnag --json visibility
```

---

## Task 10: Chrome Web Store listing assets

**Files:**
- Create: `store/description.txt`, `store/promo-440x280.png`
- Screenshots will be taken on a machine with Chrome (legion2025)

- [ ] **Step 1: Create store description file**

Save the CWS listing copy from the spec to `store/description.txt` for easy copy-paste during submission.

- [ ] **Step 2: Create small promotional tile (440x280)**

Generate an HTML template with the SocialSnag icon + name on a dark blue gradient background, render to PNG at 440x280 via Chromium headless.

- [ ] **Step 3: Plan screenshot capture**

Screenshots require the extension loaded in Chrome with real social media pages visible. This needs to happen on legion2025 (has a display + Chrome) or manually. Create a `store/screenshot-guide.md` documenting what each of the 5 screenshots should show.

- [ ] **Step 4: Commit store assets**

```bash
git add store/
git commit -m "docs: add Chrome Web Store listing assets and screenshot guide"
git push origin master
```

---

## Task 11: Chrome Web Store submission

This task is manual — requires Joe's involvement for the $5 developer registration.

- [ ] **Step 1: Register as Chrome Web Store developer** ($5 one-time fee at https://chrome.google.com/webstore/devconsole/)
- [ ] **Step 2: Create a zip of the extension** (exclude `docs/`, `store/`, `.git/`, `.github/`)

```bash
cd ~/projects/socialsnag
zip -r /tmp/socialsnag-1.0.0.zip . -x "docs/*" "store/*" ".git/*" ".github/*" "*.md"
```

- [ ] **Step 3: Upload to Chrome Web Store developer dashboard**
- [ ] **Step 4: Fill in listing details** (description, screenshots, promo tile, category, privacy fields)
- [ ] **Step 5: Submit for review**

Expected review time: 1-3 days for a new developer account with optional permissions.
