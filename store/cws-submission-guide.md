# Chrome Web Store submission guide

## Single purpose description

> SocialSnag adds right-click context menu options to download full-resolution images and videos from supported social media platforms (Instagram, Twitter/X, Facebook, Bluesky).

This is the most important field. CWS rejects extensions that don't have a clear, narrow single purpose. Ours is simple: download media from social media via the context menu.

---

## Permission justifications

CWS asks you to justify every permission. Copy these into the developer dashboard.

### contextMenus

> SocialSnag's primary interface is the browser's right-click context menu. This permission adds "Download this (HD)" and "Download all from post" options that appear only on supported social media sites. The extension has no other way for users to initiate downloads -- the context menu IS the product.

### downloads

> Required to save media files to the user's computer. SocialSnag downloads images and videos to a configurable subfolder (default: Downloads/SocialSnag/{platform}/). Without this permission, the extension cannot perform its core function.

### activeTab

> Used as a fallback to inject content scripts when declarative injection fails (e.g., after extension updates). The content scripts identify which media element the user right-clicked on and extract the download URL. activeTab grants access only when the user explicitly interacts with the extension via the context menu -- it does not grant persistent background access.

### storage

> Stores user preferences (which platforms are enabled, download folder path, notification setting) and a local download history (filenames and timestamps only -- no URLs or media content). Sync storage keeps preferences consistent across the user's devices. Local storage holds the download history on-device only.

### notifications

> Displays a brief notification when a download completes or fails, so users get confirmation that their action worked. Notifications can be disabled in the extension's settings page. The extension sends no other notifications.

### scripting

> Used as a fallback to programmatically inject content scripts into tabs when the declarative content_scripts registration fails to load (which can happen after extension updates or in certain browser configurations). This is only triggered by an explicit user action (clicking a context menu item) and only targets the active tab on a supported site.

### webRequest (optional)

> This is an OPTIONAL permission that users can enable in the extension's settings under "Deep scan (webRequest)." When enabled, it monitors network requests to social media CDNs to capture media URLs that aren't visible in the page's DOM (e.g., dynamically loaded carousel images). It is disabled by default and requires the user to explicitly opt in. The extension never modifies, blocks, or redirects any requests -- it only reads completed request URLs.

---

## Host permission justifications

### Why these specific domains?

> SocialSnag requires host permissions for each supported platform and its associated CDN domain. Content scripts run on the platform pages to detect which media the user right-clicked. The CDN domains are needed to validate and download the actual media files. Every host permission maps directly to a supported platform:
>
> - instagram.com + cdninstagram.com -- Instagram posts, reels, carousels
> - twitter.com + x.com + twimg.com -- Twitter/X posts, images, videos (twimg.com also covers the syndication API used for video resolution)
> - facebook.com + fbcdn.net -- Facebook posts and images
> - bsky.app -- Bluesky posts and images
>
> The extension does NOT access these sites in the background. Content scripts only run when the user navigates to these sites, and API calls only happen when the user explicitly clicks a context menu item.

### Why not use activeTab only?

> activeTab alone is insufficient because: (1) content scripts need to be pre-loaded before the user right-clicks so they can track which element was clicked, and (2) the background service worker needs to make API requests to platform CDNs (e.g., cdn.syndication.twimg.com for video URL resolution) that require host permissions.

### Optional host permissions (LinkedIn, TikTok)

> These are NOT included in the initial install. They are declared as optional_host_permissions so that future versions can offer LinkedIn and TikTok support without requiring a full permission re-grant. Users would need to explicitly enable these in settings, which triggers a permission prompt. They are not active by default and no code runs on these sites until the user opts in.

---

## Data use disclosure

CWS requires a privacy practices disclosure. Here's what to select:

### Does your extension collect or use any of the following data types?

- **Personally identifiable information**: No
- **Health information**: No
- **Financial and payment information**: No
- **Authentication information**: No
- **Personal communications**: No
- **Location**: No
- **Web history**: No
- **User activity**: No (download history is local-only filenames/timestamps, not browsing activity)
- **Website content**: No (the extension reads DOM elements to find media URLs, but does not collect, store, or transmit page content)

### Certifications

- "I certify that my extension does not collect or use data in ways that are not disclosed above"
- "I certify that my extension does not sell data to third parties"
- "I certify that my extension does not use or transfer data for purposes unrelated to the extension's single purpose"
- "I certify that my extension does not use or transfer data to determine creditworthiness or for lending purposes"

---

## Remote code policy

> SocialSnag does not load or execute any remote code. All JavaScript is bundled at build time using esbuild and included in the extension package. There are no external script tags, no dynamic code execution patterns, and no CDN-loaded libraries. The extension is fully self-contained.

---

## Content policies

The CWS listing should include this disclaimer (already in our store description):

> SocialSnag downloads publicly accessible media. Users are responsible for complying with copyright laws and platform terms of service. Do not download content you don't have permission to use.

This is important because CWS has rejected media download extensions that don't include a copyright disclaimer.

---

## Listing details to fill in

| Field | Value |
|-------|-------|
| Category | Productivity |
| Language | English |
| Single purpose | Right-click context menu to download HD images and videos from social media |
| Website | https://jamditis.github.io/socialsnag/ |
| Privacy policy URL | https://jamditis.github.io/socialsnag/privacy.html |
| Support URL | https://github.com/jamditis/socialsnag/issues |

## Assets to upload

| Asset | File | Size |
|-------|------|------|
| Store icon | icons/icon128.png | 128x128 |
| Screenshot 1 | store/screenshots/1-instagram-context-menu.png | 1280x800 |
| Screenshot 2 | store/screenshots/2-twitter-context-menu.png | 1280x800 |
| Screenshot 3 | store/screenshots/3-popup-download-history.png | 1280x800 |
| Screenshot 4 | store/screenshots/4-options-settings.png | 1280x800 |
| Screenshot 5 | store/screenshots/5-folder-structure.png | 1280x800 |
| Promo tile | store/promo-440x280.png | 440x280 |

## Common rejection reasons and how we address them

1. **"Extension requests more permissions than needed"** -- We mitigate this by making webRequest optional, using optional_host_permissions for LinkedIn/TikTok, and justifying every permission with a specific use case.

2. **"Extension accesses user data without disclosure"** -- Our privacy policy and data use disclosures are thorough. We store only filenames/timestamps, never URLs or media content.

3. **"Extension facilitates copyright infringement"** -- The copyright disclaimer in the description and options page addresses this. We download publicly accessible media, same as the browser's native "Save image as."

4. **"Extension uses remote code"** -- Everything is bundled. No dynamic code execution, no remote scripts.

5. **"Extension has a deceptive purpose"** -- The name, description, and screenshots clearly show what it does.

6. **"Missing or inadequate privacy policy"** -- We have a full privacy policy page at a stable GitHub Pages URL.
