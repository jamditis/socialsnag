# SocialSnag public release + Chrome Web Store submission

**Date:** 2026-03-19
**Status:** Draft
**Author:** Joe Amditis + Claude

## Overview

SocialSnag is a Chrome extension that downloads full-resolution images and videos from social media via the right-click context menu. This spec covers everything needed to ship it as a public GitHub repo and submit it to the Chrome Web Store.

## Goals

1. Make the GitHub repo public with proper documentation and licensing
2. Add a popup UI with download history
3. Design a proper SVG icon/branding
4. Harden permissions and security for Chrome Web Store approval
5. Prepare all Chrome Web Store listing assets (screenshots, promotional images, descriptions)
6. Submit to the Chrome Web Store

## Non-goals

- Automated test suite (follow-up work)
- CI/CD pipeline (follow-up work)
- Internationalization/localization

---

## 1. Platform support

### Included in Chrome Web Store submission

| Platform | Host permissions | Content script | Risk level |
|----------|-----------------|----------------|------------|
| Instagram | instagram.com, cdninstagram.com | platforms/instagram.js | Medium |
| Twitter/X | twitter.com, x.com, twimg.com | platforms/twitter.js | Low-medium |
| Facebook | facebook.com, fbcdn.net | platforms/facebook.js | Medium |

### Excluded from Chrome Web Store submission

| Platform | Reason | Code status |
|----------|--------|-------------|
| YouTube | Google owns YouTube; video download extensions are consistently removed from the store | Code stays in repo, removed from manifest |
| LinkedIn | Litigious about scraping (hiQ v. LinkedIn); medium-high rejection risk | Code stays in repo as optional |
| TikTok | Several downloaders forced to disable TikTok support on CWS | Code stays in repo as optional |

### Optional platform architecture

LinkedIn and TikTok code remains in the repo under `platforms/`. They are not included in `content_scripts` or `host_permissions` in the store-submitted manifest. Their host patterns go in `optional_host_permissions`. If a user sideloads the extension in developer mode, they can enable these platforms in settings, which triggers `chrome.permissions.request()` for the relevant domains followed by dynamic script injection via `chrome.scripting.executeScript()`.

YouTube is fully removed from the manifest (no optional support) to avoid any CWS red flags.

### Code changes for platform scoping

The following existing code references all 6 platforms and must be updated:

| File | What to change |
|------|---------------|
| `background.js` `detectPlatform()` | Remove youtube, linkedin, tiktok cases. Only return 'instagram', 'twitter', 'facebook' (plus linkedin/tiktok if dynamically enabled) |
| `background.js` `CDN_PATTERNS` | Remove linkedin/tiktok CDN patterns from the static array. These move to dynamic registration when advanced mode + optional platform is enabled |
| `options.js` `PLATFORMS` array | Remove youtube. Keep linkedin/tiktok but render them differently (grayed out with "developer mode" note) |
| `manifest.json` `content_scripts` | Remove youtube, linkedin, tiktok entries. Only instagram, twitter, facebook remain as static content scripts |
| `manifest.json` `host_permissions` | Remove youtube/ytimg patterns entirely. Move linkedin/tiktok patterns to `optional_host_permissions` |

The YouTube, LinkedIn, and TikTok `.js` files in `platforms/` stay in the repo unchanged — they're just not referenced by the manifest.

---

## 2. Permission architecture

### Core permissions (requested at install)

```json
{
  "permissions": [
    "contextMenus",
    "downloads",
    "activeTab",
    "storage",
    "notifications",
    "scripting"
  ]
}
```

**Justifications for CWS developer dashboard:**

| Permission | Justification |
|------------|---------------|
| contextMenus | Adds "Download HD media" to the right-click context menu on supported social media sites |
| downloads | Saves detected media files to the user's Downloads/SocialSnag/ folder |
| activeTab | Accesses the current tab's page content when the user right-clicks, to detect downloadable media |
| storage | Stores user preferences (enabled platforms, notification settings) and download history locally |
| notifications | Notifies the user when downloads complete or fail |
| scripting | Dynamically injects platform-specific content scripts for optional platforms (LinkedIn, TikTok) when user enables them in settings |

### Host permissions (upfront)

All three launch platforms are declared in `host_permissions` for static content script injection:

```json
{
  "host_permissions": [
    "*://*.instagram.com/*",
    "*://*.cdninstagram.com/*",
    "*://*.twitter.com/*",
    "*://*.x.com/*",
    "*://*.twimg.com/*",
    "*://*.facebook.com/*",
    "*://*.fbcdn.net/*"
  ]
}
```

### Optional permissions

```json
{
  "optional_permissions": ["webRequest"],
  "optional_host_permissions": [
    "*://*.linkedin.com/*",
    "*://*.licdn.com/*",
    "*://*.tiktok.com/*",
    "*://*.tiktokcdn.com/*",
    "*://*.tiktokcdn-us.com/*"
  ]
}
```

**webRequest:** Toggled via "advanced mode" in settings. When enabled, passively captures CDN URLs as a fallback for lazy-loaded or carousel media that DOM scraping misses. The CWS review team scrutinizes this permission heavily, so making it optional reduces friction.

### webRequest dynamic registration pattern

Since `webRequest` is an optional permission, `chrome.webRequest` is undefined until granted. The background service worker must:

1. On startup, check `chrome.storage.local` for `advancedMode: true`
2. If true, call `chrome.permissions.contains({ permissions: ['webRequest'] })` to verify the permission is still granted
3. Only if both conditions are true, register the `webRequest.onCompleted` listener
4. When the user toggles advanced mode ON in settings: request the permission via `chrome.permissions.request()`, then register the listener
5. When toggled OFF: the listener is removed on next service worker restart (no explicit removal API needed in MV3 since the worker restarts frequently)
6. All `chrome.webRequest` usage must be guarded — never call it at module-level scope

### Service worker lifecycle and captured media

MV3 service workers go idle after ~30 seconds of inactivity, which wipes in-memory state. The current `capturedMedia` Map is in-memory only. To make the webRequest capture feature reliable:

- Use `chrome.storage.session` (MV3-only) instead of an in-memory Map for captured media URLs
- `chrome.storage.session` persists for the browser session but not across browser restarts
- This survives service worker restarts while still being ephemeral

### Removed permissions

- webRequest removed from core (moved to optional)
- YouTube host patterns removed entirely

---

## 3. Popup UI

### Layout

```
+----------------------------------+
|  [icon] SocialSnag        v1.0.0 |
+----------------------------------+
|  Instagram  [*]                  |
|  Twitter/X  [*]                  |
|  Facebook   [*]                  |
+----------------------------------+
|  Recent downloads                |
|                                  |
|  [thumb] post_ABC123.jpg   2m   |
|          Instagram               |
|  [thumb] tweet_456789.jpg  1h   |
|          Twitter/X               |
|  [thumb] photo_789.jpg    3h    |
|          Facebook                |
|  ...                             |
+----------------------------------+
|  [Settings]     [Clear history]  |
+----------------------------------+
```

### Behavior

- **Platform badges:** Green dot = enabled, gray = disabled. Clicking a badge toggles the platform (same as options page).
- **Download history:** Last 20 entries from `chrome.storage.local`. Each entry shows platform icon, filename, relative timestamp. Clicking an entry calls `chrome.downloads.show(downloadId)` to reveal the file. If the file no longer exists or the downloadId is stale, show a "file not found" state and offer to remove the entry.
- **Clear history:** Removes all entries from storage.
- **Settings link:** Opens the options page in a new tab.

### Storage schema

**Two storage areas, used for different purposes:**
- `chrome.storage.sync` — user preferences (enabled platforms, notification toggle, advanced mode). Syncs across devices via Chrome account.
- `chrome.storage.local` — download history. Device-specific, not synced.

The popup reads from both: `sync` for platform status badges, `local` for history list.

Download history stored in `chrome.storage.local` under key `downloadHistory`:

```json
[
  {
    "url": "https://...",
    "filename": "post_ABC123.jpg",
    "platform": "instagram",
    "type": "image",
    "timestamp": 1710870000000,
    "downloadId": 42
  }
]
```

- Max 50 entries. Pruning happens on every write — after appending a new entry, if length > 50, remove the oldest entries.
- Popup displays the most recent 20.
- Background service worker writes entries after each successful download.

### Thumbnails

Download history entries use a **platform icon** (small colored dot/icon per platform) rather than image thumbnails. Storing thumbnail URLs is unreliable (CDN URLs expire), and generating thumbnails locally adds complexity without proportional value. The platform icon + filename + timestamp provide enough context to identify each download.

### New files

- `popup.html` -- popup markup (no inline scripts per MV3 CSP)
- `popup.js` -- render history, handle platform toggle clicks, open settings
- `popup.css` -- dark theme consistent with options page

### Manifest addition

```json
{
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
    "default_title": "SocialSnag"
  }
}
```

---

## 4. SVG icon

### Concept

A downward arrow combined with a camera aperture or media frame symbol. Clean geometric style. Blue (#3b82f6) and white on a dark background, matching the extension's UI theme.

### Requirements

- Works at 16x16, 48x48, 128x128
- Readable on both light and dark Chrome toolbar backgrounds
- No text in the icon (text becomes illegible at small sizes)
- Source SVG stored as `icons/icon.svg`
- PNGs rendered from the SVG at 16, 48, 128px

### Chrome Web Store icon

128x128 total canvas with 96x96 artwork centered (16px transparent padding on each side). Front-facing, no dramatic perspective.

---

## 5. Security hardening

### URL validation

Before passing any URL to the downloads API, validate it against an allowlist of expected CDN domains:

```
ALLOWED_DOWNLOAD_DOMAINS:
  cdninstagram.com
  pbs.twimg.com
  video.twimg.com
  fbcdn.net
  media.licdn.com
  tiktokcdn.com
  tiktokcdn-us.com
```

Reject any URL whose hostname does not end with one of these domains. This prevents a compromised page from tricking the extension into downloading malware.

### Filename sanitization

Strip path traversal sequences and invalid characters from all filenames before download. Replace `../`, `..\`, and characters like `<>:"/\|?*` with underscores.

### HTTPS enforcement

Reject any download URL that is not HTTPS. Social media CDNs all serve over HTTPS -- an HTTP URL is a red flag.

### Message validation

**Background service worker (receives messages from content scripts):** Verify `sender.id === chrome.runtime.id` on all incoming messages. This ensures only our own content scripts can trigger downloads or request captured media.

**Content scripts (receive messages from background via `chrome.tabs.sendMessage`):** No sender validation needed. In MV3, `chrome.tabs.sendMessage` is extension-internal — only the extension's own background/popup can send messages to its content scripts. Web pages cannot inject messages into this channel.

### DOM rendering safety

All text rendered in popup and options pages uses `textContent`, never `innerHTML`. This prevents XSS from malicious filenames or URLs stored in download history.

### No remote code execution

All logic is bundled in the extension package. No external script tags, no dynamic code construction or evaluation. The MV3 Content Security Policy enforces this, and the codebase already complies.

### Context menu visibility

Add `documentUrlPatterns` to both context menu items so they only appear on supported sites:

```json
["*://*.instagram.com/*", "*://*.twitter.com/*", "*://*.x.com/*", "*://*.facebook.com/*"]
```

This prevents the "Download HD" menu from appearing on unsupported sites (confusing for users, and CWS reviewers notice).

### Content script isolation

All content scripts run in the default ISOLATED world. This is correct for DOM scraping — content scripts can read DOM elements and `<script>` tag text content (used by Instagram's JSON extraction) without needing MAIN world access. No change needed.

---

## 6. Options page updates

### Changes

1. Add copyright disclaimer at the bottom of the options page
2. Add "advanced mode" toggle for webRequest permission (with explanation of what it does)
3. Add privacy policy link pointing to PRIVACY.md on GitHub
4. Platform toggles: Instagram, Twitter/X, Facebook remain as checkboxes. YouTube removed. LinkedIn and TikTok shown as "available in developer mode" with a note.
5. Visual refresh to match popup styling — extract inline styles to `options.css` for consistency with `popup.css`
6. Migrate from `options_page` to `options_ui` in manifest: `"options_ui": { "page": "options.html", "open_in_tab": true }` (MV3 convention)

### Copyright disclaimer text

SocialSnag downloads publicly accessible media. Users are responsible for complying with copyright laws and platform terms of service in their jurisdiction. Do not download content you don't have permission to use.

---

## 7. Repository public release

### New files

| File | Purpose |
|------|---------|
| LICENSE | MIT license, copyright Joe Amditis |
| README.md | Project overview, features, install instructions (sideload + store), screenshots, privacy note |
| .gitignore | OS files, editor files, *.pem, .env, node_modules/, dist/ |
| PRIVACY.md | Full privacy policy (see section 8) |
| CHANGELOG.md | Version history, starting at 1.0.0 for public release |
| .github/copilot-instructions.md | Context for Copilot code review (see below) |

### Copilot instructions content

The `.github/copilot-instructions.md` should describe:
- Extension architecture: background service worker + per-platform content scripts + shared common.js
- Message passing pattern: background sends `resolve` to content script, content script returns `{ urls, platform }`
- Platform resolver pattern: each platform calls `SocialSnag.init()` then `SocialSnag.registerResolver()`
- URL upgrade pattern: each platform has a function that rewrites CDN URLs to full-resolution
- Key review flags: innerHTML usage (XSS risk), URL validation bypass, new host_permissions additions, permission creep

### GitHub repo changes

- Flip visibility from private to public
- Add topics: chrome-extension, social-media, media-downloader, manifest-v3, instagram, twitter
- Set description: "Chrome extension for downloading HD media from social media via context menu"
- Set homepage URL to Chrome Web Store listing (once published)

### Version bump

Bump from 0.1.0 to 1.0.0 for the public release.

---

## 8. Privacy policy

Hosted at PRIVACY.md in the repo root and linked from:
- Chrome Web Store developer dashboard
- Options page footer
- README.md

### Content

1. **What data is collected:** Download history (filenames, timestamps, platform names) stored locally. User preferences (enabled platforms, notification settings) stored locally.
2. **What data is NOT collected:** No browsing history, no personal information, no analytics, no telemetry, no tracking.
3. **Where data is stored:** Locally on the user's device via Chrome's storage API. No data leaves the device.
4. **Third-party sharing:** None. No data is transmitted to external servers.
5. **activeTab behavior:** Page content is accessed only when the user initiates a right-click action. Only media URLs are extracted — no page content is stored, logged, or transmitted.
6. **User control:** Users can clear download history from the popup. Uninstalling the extension deletes all stored data.
7. **Contact:** Joe Amditis email or GitHub issues link.

### CWS data disclosure

In the developer dashboard privacy fields:
- "User activity": Not collected
- "Website content": Not collected (the extension reads page DOM to find media URLs but does not store or transmit page content)
- All "not sold, not used for ads, no human access" certifications checked

---

## 9. Chrome Web Store listing

### Listing copy

**Name:** SocialSnag

**Summary (132 chars):** Download full-resolution images and videos from social media with a right-click.

**Description:**

SocialSnag adds a right-click context menu to download HD images and videos from your favorite social media platforms.

Supported platforms:
- Instagram (images, reels, carousels)
- Twitter / X (images, profile pictures)
- Facebook (images, videos)

Features:
- Right-click any image or video to download the full-resolution version
- "Download all from post" grabs every media item in a carousel or multi-image post
- Download history in the popup for quick access to recent saves
- Files organized by platform in your Downloads/SocialSnag/ folder
- Toggle platforms on or off in settings
- Optional advanced mode for improved media detection

Privacy:
SocialSnag stores preferences and download history locally on your device. No data is collected, transmitted, or shared with anyone.

SocialSnag downloads publicly accessible media. Users are responsible for complying with copyright laws and platform terms of service. Do not download content you don't have permission to use.

**Category:** Productivity (better fit for a download tool than "Photos", which implies editing/management)

### Visual assets

| Asset | Size | Description |
|-------|------|-------------|
| Screenshot 1 | 1280x800 | Right-click context menu on an Instagram post |
| Screenshot 2 | 1280x800 | Right-click context menu on a Twitter/X image |
| Screenshot 3 | 1280x800 | Popup showing download history |
| Screenshot 4 | 1280x800 | Options/settings page |
| Screenshot 5 | 1280x800 | Downloads folder showing organized SocialSnag files |
| Small promo tile | 440x280 | Extension icon + name on brand-colored background |

### Developer account

Chrome Web Store developer registration: $5 one-time fee. Supports up to 20 extensions.

---

## 10. File structure (after changes)

```
socialsnag/
  .github/
    copilot-instructions.md
  docs/
    superpowers/
      specs/
        2026-03-19-socialsnag-public-release-design.md
  icons/
    icon.svg          (new - source vector)
    icon16.png        (regenerated from SVG)
    icon48.png        (regenerated from SVG)
    icon128.png       (regenerated from SVG)
  platforms/
    common.js         (updated - add URL validation helpers)
    instagram.js      (minor updates)
    twitter.js        (minor updates)
    facebook.js       (minor updates)
    linkedin.js       (unchanged - optional platform)
    tiktok.js         (unchanged - optional platform)
    youtube.js        (unchanged - excluded from manifest)
  background.js       (updated - download history, URL validation, message validation, optional webRequest/platform injection)
  manifest.json       (updated - permissions, popup, version bump, optional_permissions)
  options.html        (updated - disclaimer, advanced mode, privacy link, external CSS)
  options.css         (new - extracted from inline styles in options.html)
  options.js          (updated - advanced mode toggle, dynamic permission request)
  popup.html          (new)
  popup.js            (new)
  popup.css           (new)
  .gitignore          (new)
  CHANGELOG.md        (new)
  LICENSE             (new)
  PRIVACY.md          (new)
  README.md           (new)
```

---

## 11. Implementation order

1. Security hardening (URL validation, filename sanitization, message validation)
2. Permission refactor (manifest changes, optional permissions, dynamic injection)
3. SVG icon design + PNG renders
4. Popup UI (HTML, JS, CSS, download history integration)
5. Options page updates (disclaimer, advanced mode, privacy link)
6. Repo files (LICENSE, README, .gitignore, PRIVACY.md, CHANGELOG.md, copilot-instructions)
7. Version bump to 1.0.0
8. Make repo public + add GitHub topics
9. Chrome Web Store assets (screenshots, promotional tile)
10. Chrome Web Store submission
