# Changelog

## 1.2.1 — 2026-07-07

### Fixed
- Instagram feed and profile-grid carousels now return every slide in "download all". The content script recovers the post's shortcode from the page permalink and resolves the whole post through the media API, fixing the cap at the two or so slides Instagram lazy-renders in feed and grid views. Post-detail pages already worked; this extends the same coverage to the feed and grid (#32).

### Added
- Chrome Web Store publish automation: `npm run publish:cws` uploads the built zip and publishes through the Chrome Web Store API v2. Credentials are read from the environment and never committed. One-time setup is in `docs/cws-publishing.md`.

## 1.2.0 — 2026-07-07

### New
- Instagram stories — "download this" grabs the story you're viewing, "download all" grabs the user's full active tray. Stories were previously unsupported.
- Copy media URL — a right-click action that copies the resolved full-resolution URL to your clipboard instead of downloading the file.
- Download all as .zip — bundle a carousel or story into a single archive. Available as a global default in settings, or per-download from the right-click menu, which forces a .zip regardless of the default.

### Fixed
- Instagram carousel and "download all" now return every slide, in order, at full resolution. Resolution goes through Instagram's media API instead of scraping the page, so lazy-loaded slides are no longer missed (previously it often returned only the first image). Falls back to page scraping when the API is unavailable.
- Instagram failures now name the reason — login required, rate-limited, or the post is expired or deleted — instead of a generic "could not find media."

### Changed
- The four context-menu actions now nest under one SocialSnag parent submenu instead of sitting at the top level.
- Added the extension's first offscreen document to build zips and write to the clipboard, neither of which an MV3 service worker can do directly.
- New permission: `offscreen` (no install warning). `clipboardWrite` is requested only when you first use "Copy media URL", not upfront, so the update installs without disabling the extension for existing users. No new site-access (host) permissions were added.
- Removed a dead, unreachable TikTok code path from the service worker.

## 1.1.0 — 2026-03-20

### New
- Bluesky platform support — images, videos, and avatars at full resolution
- Redesigned popup UI — dark theme, status grid, SVG platform icons, bundled Syne/Outfit fonts
- Redesigned options page — card layout, custom toggle switches, save on change
- Redesigned extension icon — gradient arrow, grid texture, neon glow
- New landing page with animated context menu demo
- GitHub Actions CI (lint, test, build on PRs)

### Fixed
- Instagram videos now download via script extraction (no longer blocked by blob: URLs)
- Instagram "Download all" more reliable on feed (broader container selectors, fallback ancestor walk)
- JSON unicode escape decoding in extracted URLs (`\u0026` → `&`)
- Duplicate video URLs no longer pushed when multiple blob: videos exist in a post
- Options page no longer silently overrides notification preference
- `document.body` references safe in non-browser contexts

### Changed
- ESM modules with esbuild bundler (source in `src/`, build output in `dist/`)
- Domain allowlist deduplicated — single source of truth in `common.js`
- CWS screenshots and promo tile with new branding

## 1.0.0 — 2026-03-19

Initial public release.

- Right-click context menu to download HD media from Instagram, Twitter/X, and Facebook
- Popup with download history
- Options page with platform toggles and advanced mode
- URL domain validation and filename sanitization
- Privacy-first: all data stored locally, nothing transmitted
