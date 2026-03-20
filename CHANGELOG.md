# Changelog

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
