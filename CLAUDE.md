# CLAUDE.md

## What this is

SocialSnag — Chrome extension (Manifest V3) that downloads full-resolution images and videos from social media via right-click context menu.

**Repo:** https://github.com/jamditis/socialsnag (public)
**Version:** 1.2.0
**Author:** Joe Amditis

## Architecture

ESM modules in `src/`, bundled by esbuild to `dist/`. Chrome loads from `dist/`.

```
src/
  background.js          — service worker: context menu (SocialSnag submenu), downloads, URL validation, download history, Instagram API resolution (posts + stories), zip and copy-URL routing, optional webRequest
  platforms/common.js    — shared exports: ALLOWED_DOMAINS, isAllowedDomain, isHttps, sanitizeFilename, findPostContainer, findNearestMedia, getCapturedMedia
  platforms/instagram.js — Instagram DOM resolver (srcset upgrade, JSON extraction, video script extraction, carousel support) — the fallback when the API path fails
  platforms/instagram-api.js — Instagram private web API (pure module): shortcodeToMediaId, parsePostMedia (single + carousel), extractStoryRef, parseStoryTray, mapIgStatusToMessage
  platforms/twitter.js   — Twitter/X resolver (name=orig rewrite, profile pic upgrade, video via webRequest captures)
  platforms/facebook.js  — Facebook resolver (fbcdn upgrade, video extraction from scripts)
  platforms/bluesky.js   — Bluesky resolver (feed_fullsize upgrade, avatar upgrade, direct video URLs)
  platforms/linkedin.js  — LinkedIn resolver — NOT in manifest, needs ESM conversion
  platforms/tiktok.js    — TikTok resolver — NOT in manifest, needs ESM conversion
  platforms/youtube.js   — YouTube resolver — NOT in manifest, fully excluded
  popup.html/js/css      — popup UI: dark theme, platform status grid, download history with SVG icons
  options.html/js/css    — settings: card layout, custom toggle switches, save on change
  offscreen.html/js      — offscreen document: builds zips (client-zip) and writes the clipboard, which an MV3 service worker cannot do directly
  offscreen-host.js      — service-worker side helpers to create the offscreen doc and call it (copyViaOffscreen, zipViaOffscreen, revokeViaOffscreen)
  fonts/syne.woff2       — Syne display font (bundled, not CDN)
  fonts/outfit.woff2     — Outfit body font (bundled, not CDN)
```

### Build

```bash
npm install                    # install dev deps (esbuild, vitest, eslint)
npm run build                  # bundle to dist/
npm run build:zip              # bundle + minify + create socialsnag-{version}.zip
npm test                       # run vitest (204 tests)
npm run lint                   # eslint src/
```

### Message flow

1. User right-clicks on supported site
2. Background receives `contextMenus.onClicked`, calls `chrome.tabs.sendMessage({ action: 'resolve' })`
3. Content script's resolver finds media URLs in the DOM (or extracts from page scripts for blob: videos)
4. Content script responds with `{ urls: [...], platform: '...' }`
5. Background validates each URL (HTTPS, domain allowlist, dot-boundary check), sanitizes filename, downloads
6. Background records download to `chrome.storage.local` history

### ESM module pattern

Each platform file exports pure functions (testable in Node) and keeps browser wiring in `initContentScript()`:

```js
// Pure functions — exported for testing
export function upgradeImageUrl(url) { ... }

// Browser wiring — guarded, only runs in Chrome
function initContentScript() { ... }
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
```

The `typeof document` guard prevents ReferenceErrors when Vitest imports the module.

### Storage areas

- `chrome.storage.sync` — user preferences (platform toggles, notification setting, advancedMode flag)
- `chrome.storage.local` — download history (max 50 entries, pruned on write)
- `chrome.storage.session` — captured media URLs from webRequest (ephemeral)

### Domain allowlist (single source of truth)

`ALLOWED_DOMAINS` is defined once in `src/platforms/common.js` and imported by `src/background.js`. The list:
- `cdninstagram.com`, `pbs.twimg.com`, `video.twimg.com`, `fbcdn.net`, `cdn.bsky.app`, `video.bsky.app`

## Chrome Web Store compliance

### Platforms included in CWS submission
Instagram, Twitter/X, Facebook, Bluesky.

### Platforms excluded
- **YouTube** — fully removed. Google removes YT download extensions.
- **LinkedIn** — code in repo, `optional_host_permissions`. Needs ESM conversion. Medium-high rejection risk.
- **TikTok** — code in repo, `optional_host_permissions`. Needs ESM conversion. Medium-high rejection risk.

### Permission model
- Core: `contextMenus`, `downloads`, `activeTab`, `storage`, `notifications`, `scripting`, `offscreen`
- Optional: `clipboardWrite`, `webRequest`
- `clipboardWrite` is optional (not upfront) on purpose: adding an install-warning permission to a published extension disables it for every existing user until they re-approve. The copy handler requests it on the first "Copy media URL" click (a context-menu click carries the user gesture), so the update installs silently and only people who copy ever see a prompt. `webRequest` is toggled via "advanced mode" in settings.
- Host permissions (upfront): Instagram + CDN, Twitter/X + CDN, Facebook + CDN, Bluesky + CDN
- Optional host permissions: LinkedIn + CDN, TikTok + CDN

### Security requirements
- **Domain allowlist with dot-boundary check** — `hostname === d || hostname.endsWith('.'+d)`
- **HTTPS only** — reject non-HTTPS download URLs
- **Filename sanitization** — strip `../`, `..\`, and `<>:"/\|?*` characters
- **Sender validation** — `sender.id === chrome.runtime.id` on all background onMessage handlers
- **No remote code** — everything bundled, fonts included as woff2
- **No URL storage** — download history stores filename/platform/timestamp, NOT the CDN URL

## Development

### Load the extension
1. `npm install && npm run build`
2. `chrome://extensions` > Developer mode > Load unpacked > select `dist/` folder

### Key files to check after changes
- `manifest.json` — permissions, content_scripts, version
- `src/background.js` — the security gate (URL validation, `validateDownloadUrl()`)
- `src/platforms/common.js` — shared domain allowlist
- `src/offscreen.js` / `src/offscreen-host.js` — the offscreen document and its service-worker callers (sender validation, zip/copy/revoke)
- `build.js` — entry points, manifest rewrite, asset copying

### Testing
```bash
npm test                           # all 204 tests
npx vitest run test/instagram.test.js  # single file
npm run test:watch                 # watch mode
```

### CI
GitHub Actions runs lint + test + build on every PR to master (`.github/workflows/ci.yml`).

## Instagram video downloads

Instagram videos use `blob:` URLs (MediaSource API). Direct `video.src` is always unusable. SocialSnag extracts the actual CDN video URL from Instagram's embedded page scripts:

1. `extractVideoUrlFromScripts(scriptTexts)` searches for `"video_url":"..."` and `"video_versions":[{"url":"..."}]` patterns
2. `decodeJsonString()` handles `\/` and `\u0026` JSON escapes
3. Script texts are cached per container to avoid repeated DOM queries
4. A `Set` tracks used URLs to prevent duplicates when multiple blob: videos exist

This works without advanced mode (webRequest) enabled.

## Current status

### Done (v1.2.0)
- Instagram carousel and bulk download resolve through the media API (every slide, in order), with DOM scraping as the fallback
- Instagram stories: the viewed story and the user's whole active tray, via the reels_media API
- Copy media URL and download-all-as-zip, both routed through the extension's first offscreen document (client-zip for the archive)
- `zipMultiPosts` global setting plus a per-download .zip menu item that overrides it
- Context menu reorganized under a SocialSnag parent submenu
- Specific Instagram error messages: login required, rate-limited, expired or deleted
- Dead TikTok code path removed from the service worker
- 204 unit tests (vitest)
- New permissions: `offscreen` (required); `clipboardWrite` (optional, requested on first Copy media URL) — no new host permissions

### Done (v1.1.0)
- 4 platforms: Instagram, Twitter/X, Facebook, Bluesky
- ESM + esbuild build pipeline
- 122 unit tests (vitest)
- GitHub Actions CI
- Dark-themed popup and options UI with bundled fonts
- CWS screenshots, promo tile, landing page
- GitHub releases: v1.0.0, v1.1.0
- Twitter/X video downloads via syndication API (background script, no webRequest needed)
- Instagram video downloads via media API with shortcode-to-mediaId conversion
- Configurable download folder path in settings
- CWS submission completed 2026-03-20, approved and published 2026-03-23
- Extension ID: `llbpeneloehnlaomolbalbmhjncpmnfa`

### Chrome Web Store
- **Initial CWS publish date:** 2026-03-23 — Item ID: `llbpeneloehnlaomolbalbmhjncpmnfa`
- CWS listing (source of truth for dates/versions): https://chromewebstore.google.com/detail/socialsnag/llbpeneloehnlaomolbalbmhjncpmnfa

### Pending
- Upload social preview image in GitHub Settings > General > Social preview

### Future work
- LinkedIn/TikTok ESM conversion and re-evaluation after CWS approval
- Automated E2E tests with Playwright
