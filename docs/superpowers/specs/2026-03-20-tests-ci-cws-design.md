# SocialSnag: tests, CI, and CWS prep

**Date:** 2026-03-20
**Status:** Design approved
**Scope:** ESM migration, automated test suite, GitHub Actions CI, Chrome Web Store submission assets

## Overview

Migrate SocialSnag from plain JS (no modules, no build step) to ESM with esbuild bundling. Add a Vitest test suite covering all pure functions, ESLint for code quality, GitHub Actions CI on pull requests, and Playwright-generated CWS screenshots.

## Architecture changes

### ESM migration

Current state: all files use file-scoped functions with a global `SocialSnag` object in `common.js`. No exports, no build step. Chrome loads files directly from the repo root.

Target state: ES modules in `src/`, esbuild bundles to `dist/`, Chrome loads from `dist/`.

### Project structure

```
socialsnag/
  src/
    background.js          # service worker entry point
    popup.js               # popup entry point
    popup.html
    popup.css
    options.js             # options entry point
    options.html
    options.css
    platforms/
      common.js            # shared utilities (exported functions)
      instagram.js         # imports from common.js
      twitter.js
      facebook.js
      linkedin.js          # kept for sideload, excluded from default build
      tiktok.js
      youtube.js           # kept for reference, never built
  test/
    chrome-mock.js         # lightweight chrome.* API stubs
    setup.js               # vitest global setup
    background.test.js
    common.test.js
    instagram.test.js
    twitter.test.js
    facebook.test.js
    popup.test.js
  dist/                    # build output (gitignored)
    manifest.json
    background.js
    popup.html/js/css
    options.html/js/css
    platforms/
      instagram.js         # bundled (includes common.js inlined)
      twitter.js
      facebook.js
    icons/
  store/                   # CWS listing assets (existing files unchanged; screenshots/ added by automation)
  docs/                    # landing page (unchanged)
  icons/                   # source icons
  manifest.json            # source manifest (copied to dist/ during build)
  build.js                 # esbuild build script
  package.json
  vitest.config.js
  eslint.config.js
  .github/workflows/ci.yml
```

### Module conversion pattern

**Separate pure logic from browser glue.** Each file exports its pure functions (URL upgrade, validation, extraction) and keeps browser wiring (event listeners, Chrome API calls) in an `initContentScript()` function that auto-runs when Chrome APIs are available.

**`src/platforms/common.js`** — replaces the `SocialSnag` global object:

```js
export const ALLOWED_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
];

export function isAllowedDomain(url) { ... }
export function isHttps(url) { ... }
export function sanitizeFilename(name) { ... }
export function extractId(url, pattern) { ... }
export function findPostContainer(element, selectors) { ... }
export function collectMediaInContainer(container) { ... }
export function findNearestMedia(element) { ... }
```

**Platform content scripts** (e.g., `src/platforms/instagram.js`):

```js
import { findNearestMedia, findPostContainer } from './common.js';

// Pure functions — exported for testing
export function upgradeImageUrl(url, imgElement) { ... }
export function extractShortcode(pathname) { ... }  // takes pathname arg, not window.location

// Browser bootstrap — only runs in Chrome context
export function initContentScript() {
  let lastTarget = null;
  document.addEventListener('contextmenu', (e) => { lastTarget = e.target; }, true);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      resolve(message, lastTarget).then(r => sendResponse(r)).catch(...);
      return true;
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  initContentScript();
}
```

**`src/background.js`** — same separation, imports shared allowlist:

```js
import { ALLOWED_DOMAINS } from './platforms/common.js';

export function detectPlatform(url) { ... }
export function guessExtension(url, type) { ... }
export function validateDownloadUrl(url) { ... }  // extracted from downloadMedia(), uses ALLOWED_DOMAINS
export function sanitizeDownloadPath(filename, platform, ext) { ... }
```

### Domain allowlist: single source of truth

Currently `ALLOWED_DOWNLOAD_DOMAINS` is duplicated in `background.js` (lines 22-27) and `common.js` (`_ALLOWED_DOMAINS`, lines 86-91). After migration, `common.js` is the single source. `background.js` imports it:

```js
import { ALLOWED_DOMAINS } from './platforms/common.js';
```

### Testability refactoring for DOM-dependent functions

Several functions currently read from `document` directly. These are refactored to accept data as arguments:

**`extractFromPageJson(jsonStrings)`** (Instagram) — currently calls `document.querySelectorAll('script[type="application/ld+json"]')`. Refactored to accept an array of JSON strings, so the caller extracts script content and the function only does parsing:

```js
// Pure — exported for testing
export function parseMediaFromJson(jsonStrings) {
  const items = [];
  for (const text of jsonStrings) {
    try {
      const data = JSON.parse(text);
      if (data.image) { /* extract items */ }
    } catch (e) { /* ignore */ }
  }
  return items;
}

// Browser wrapper — calls the pure function
function extractFromPageJson() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  return parseMediaFromJson([...scripts].map(s => s.textContent));
}
```

**`findVideoUrl(scriptTexts)`** (Facebook) — same pattern. The regex matching logic is split from the DOM query:

```js
// Pure — exported for testing
export function extractVideoUrlFromScripts(scriptTexts) {
  for (const text of scriptTexts) {
    const hdMatch = text.match(/"playable_url_quality_hd":"(https?:[^"]+)"/);
    if (hdMatch) return hdMatch[1].replace(/\\\//g, '/');
    const sdMatch = text.match(/"playable_url":"(https?:[^"]+)"/);
    if (sdMatch) return sdMatch[1].replace(/\\\//g, '/');
  }
  return null;
}
```

**`extractShortcode(pathname)`** (Instagram), **`extractPostId(pathname)`** (LinkedIn), **`extractVideoId(pathname)`** (TikTok) — all take `pathname` as an argument instead of reading `window.location.pathname`. Callers pass `window.location.pathname` at call sites.

### esbuild configuration

`build.js` script:

- Entry points: `src/background.js`, `src/platforms/instagram.js`, `src/platforms/twitter.js`, `src/platforms/facebook.js`, `src/popup.js`, `src/options.js`
- Output: `dist/` preserving directory structure
- Format: IIFE for content scripts (injected into page context), IIFE for background (service worker)
- Bundle: true (inlines imports)
- Copy step: HTML files, CSS files, `icons/` to `dist/`
- Manifest rewrite: see below
- No minification in dev, minified for CWS zip

### Manifest rewrite during build

The source `manifest.json` lists `["platforms/common.js", "platforms/instagram.js"]` per content script entry. After esbuild bundles each platform script with `common.js` inlined, the manifest must list only one JS file per entry. The build script reads `manifest.json`, rewrites the `content_scripts[].js` arrays to remove `"platforms/common.js"`, and writes the modified manifest to `dist/manifest.json`.

Example transform:
```json
// Source manifest
"js": ["platforms/common.js", "platforms/instagram.js"]

// dist/ manifest (after build)
"js": ["platforms/instagram.js"]
```

### HTML script tag paths

`popup.html` references `<script src="popup.js">` and `options.html` references `<script src="options.js">`. Since esbuild preserves the same relative filenames in `dist/` (e.g., `dist/popup.js`), no rewriting of HTML script tags is needed. The HTML files are copied as-is.

## Test design

### Test runner: Vitest

Native ESM support, fast execution, Jest-compatible API. Config in `vitest.config.js`.

### Chrome API mock: `test/chrome-mock.js`

Lightweight in-memory stubs for the Chrome APIs used by the extension:

```js
const createStorageArea = () => {
  let data = {};
  return {
    get: async (keys) => { /* return matching keys with defaults */ },
    set: async (items) => { Object.assign(data, items); },
    remove: async (keys) => { /* delete keys */ },
    _reset: () => { data = {}; },
  };
};

globalThis.chrome = {
  storage: {
    sync: createStorageArea(),
    local: createStorageArea(),
    session: createStorageArea(),
  },
  runtime: {
    id: 'test-extension-id',
    getManifest: () => ({ version: '1.0.0' }),
  },
};
```

Loaded via `test/setup.js` in Vitest's `setupFiles` config.

### Test coverage by file

**`test/common.test.js`** — shared utility functions:
- `isAllowedDomain()`: valid CDN domains, subdomain matching, dot-boundary attack (`evilcdninstagram.com` rejects), malformed URLs
- `isHttps()`: https passes, http/ftp/garbage fail
- `sanitizeFilename()`: path traversal (`../`, `..\`), special characters stripped, null input, control characters
- `extractId()`: regex match extraction, no match returns null
- `findNearestMedia()`: element stubs with tagName/querySelector/parentElement

**`test/background.test.js`** — background service worker logic:
- `detectPlatform()`: each platform URL, subdomains, non-matching, null/empty
- `guessExtension()`: video type override, format param, path extension, fallback .jpg
- `validateDownloadUrl()`: HTTPS check, domain allowlist, malformed URL rejection
- `sanitizeDownloadPath()`: path assembly, filename sanitization

**`test/instagram.test.js`** — Instagram resolver:
- `upgradeImageUrl()`: srcset parsing (highest width), size constraint removal, non-IG URLs null
- `extractShortcode()`: `/p/ABC/`, `/reel/XYZ/`, `/tv/` prefix, no match null
- `parseMediaFromJson()`: pass JSON strings directly (no DOM needed), single image, array of images, malformed JSON ignored

**`test/twitter.test.js`** — Twitter resolver:
- `upgradeImageUrl()`: `name=orig` append, profile pic size suffix removal (`_normal.`, `_400x400.`), non-twimg filtered
- `extractTweetId()`: DOM mock with status link
- `filterCapturedVideos()`: extracted pure filtering/sorting logic from `resolveVideo()` — filters by `video.twimg.com` domain and `.mp4` extension, sorts by timestamp descending

**`test/facebook.test.js`** — Facebook resolver:
- `upgradeUrl()`: size constraint removal, non-fbcdn filtered
- `extractPhotoId()`: numeric ID extraction, no match
- `extractVideoUrlFromScripts()`: pass script text strings directly (no DOM needed), `playable_url_quality_hd` regex, `playable_url` fallback, escaped slash handling

**`test/popup.test.js`** — popup UI logic:
- `relativeTime()`: under 1 minute ("now"), minutes, hours, days boundary values

### What's NOT tested (and why)

- Chrome event handler wiring (onInstalled, onClicked, onMessage) — these are integration-level concerns that require a real browser
- Download execution (chrome.downloads.download) — mocking this provides false confidence
- Storage read/write in context — the mock verifies the interface works, but real storage behavior needs manual testing
- `options.js` — entirely DOM + Chrome storage wiring, no pure functions to extract

## CI design

### GitHub Actions workflow (`.github/workflows/ci.yml`)

Triggers: `pull_request` against `master` only.

```yaml
name: CI
on:
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
```

Steps: install deps, lint (ESLint), test (Vitest), build (esbuild). Build step catches import errors that unit tests might miss.

### ESLint config

Flat config format (`eslint.config.js`). Rules: `eslint:recommended` plus:
- `no-eval: error`
- `no-implied-eval: error`
- No `innerHTML` usage (enforced by existing code convention, optionally via custom rule)

### npm scripts

```json
{
  "scripts": {
    "build": "node build.js",
    "build:zip": "node build.js --zip",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/"
  }
}
```

## CWS prep

### Build + zip

`npm run build:zip` builds to `dist/`, then creates `socialsnag-<version>.zip` containing only the extension files (no tests, docs, store assets, or git history).

### Screenshots via Playwright on officejawn

SSH to officejawn, run a Playwright script that:

1. Launches Chromium with the built extension loaded (`--load-extension=dist/`)
2. Navigates to mock HTML pages simulating Instagram/Twitter/Facebook post layouts
3. Injects context menu appearance via DOM (Chrome doesn't allow programmatic context menu screenshots, so we simulate the visual)
4. Takes 1280x800 screenshots per the existing `store/screenshot-guide.md`
5. Copies screenshots to `store/screenshots/` on houseofjawn

Mock pages avoid needing real social media logins. They replicate the visual layout with placeholder images and the extension's UI overlaid.

### Screenshots needed (per screenshot-guide.md)

1. Instagram context menu on a post
2. Twitter/X context menu on an image
3. Popup with download history (3-5 entries)
4. Options/settings page with platform toggles
5. Downloads folder structure (SocialSnag/platform subfolders)

### CWS listing assets already done

- `store/description.txt` — listing description
- `store/promo-440x280.png` — small promo tile
- `docs/og-image.png` — can be reused for CWS listing

## Dependencies added

| Package | Purpose | Dev only |
|---------|---------|----------|
| esbuild | Bundler | Yes |
| vitest | Test runner | Yes |
| eslint | Linter | Yes |

No runtime dependencies. The extension remains dependency-free in production.

### package.json

No `package.json` exists yet. Create one during migration:

```json
{
  "name": "socialsnag",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.js",
    "build:zip": "node build.js --zip",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "vitest": "^3.0.0",
    "eslint": "^9.0.0"
  }
}
```

`"type": "module"` enables ESM imports in `build.js` and `vitest.config.js`. CI runs `npm ci` which requires `package-lock.json` — generated by `npm install` and committed.

### .gitignore update

Add to `.gitignore` (or create if missing):

```
dist/
node_modules/
socialsnag-*.zip
```

## Migration path

The ESM migration is a refactor — no behavioral changes to the extension. The `dist/` output should be functionally identical to the current unbundled files. Verification: load both versions in Chrome and compare behavior on test sites.

## Risk assessment

- **ESM migration breaks something**: Low risk. esbuild IIFE output is equivalent to the current file-scope pattern. The manifest points to `dist/` files instead of root files — same content, different path.
- **Content script injection order**: Medium risk. Currently `common.js` loads before each platform script via manifest `content_scripts.js` array order. After migration, `common.js` is imported and inlined by esbuild — no load order dependency. This is strictly better.
- **CI false positives/negatives**: Low risk. Tests cover pure functions with deterministic inputs/outputs. No flaky browser tests.
