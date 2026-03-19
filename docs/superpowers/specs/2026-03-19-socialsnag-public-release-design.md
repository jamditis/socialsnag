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
- **Download history:** Last 20 entries from `chrome.storage.local`. Each entry shows filename, platform, relative timestamp. Clicking an entry calls `chrome.downloads.show(downloadId)` to reveal the file.
- **Clear history:** Removes all entries from storage.
- **Settings link:** Opens the options page in a new tab.

### Storage schema

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

- Max 50 entries. When exceeded, oldest entries are pruned.
- Popup displays the most recent 20.
- Background service worker writes entries after each successful download.

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

In the background service worker, verify that messages come from the extension itself by checking `sender.id === chrome.runtime.id` on all incoming messages.

### DOM rendering safety

All text rendered in popup and options pages uses `textContent`, never `innerHTML`. This prevents XSS from malicious filenames or URLs stored in download history.

### No remote code execution

All logic is bundled in the extension package. No external script tags, no dynamic code construction or evaluation. The MV3 Content Security Policy enforces this, and the codebase already complies.

---

## 6. Options page updates

### Changes

1. Add copyright disclaimer at the bottom of the options page
2. Add "advanced mode" toggle for webRequest permission (with explanation of what it does)
3. Add privacy policy link pointing to PRIVACY.md on GitHub
4. Platform toggles: Instagram, Twitter/X, Facebook remain as checkboxes. YouTube removed. LinkedIn and TikTok shown as "available in developer mode" with a note.
5. Visual refresh to match popup styling

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
| .github/copilot-instructions.md | Context for Copilot code review |

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
5. **User control:** Users can clear download history from the popup. Uninstalling the extension deletes all stored data.
6. **Contact:** Joe Amditis email or GitHub issues link.

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

**Category:** Photos

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
  options.html        (updated - disclaimer, advanced mode, privacy link)
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
