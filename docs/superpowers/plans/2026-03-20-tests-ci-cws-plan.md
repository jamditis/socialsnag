# SocialSnag: tests, CI, and CWS prep — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate SocialSnag to ESM + esbuild, add Vitest tests for all pure functions, set up GitHub Actions CI, and generate CWS screenshots.

**Architecture:** Move source files to `src/`, add `export` to pure functions while separating browser glue into `initContentScript()` auto-init blocks. esbuild bundles each entry point to IIFE in `dist/`. Tests import directly from `src/` modules.

**Tech Stack:** esbuild, Vitest, ESLint 9 (flat config), GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-20-tests-ci-cws-design.md`

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/esm-tests-ci
```

All subsequent tasks commit to this branch. Push and PR happen in Task 20.

---

### Task 1: Project scaffolding — package.json, .gitignore, configs

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `vitest.config.js`
- Create: `eslint.config.js`

- [ ] **Step 1: Create package.json**

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
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0"
  }
}
```

- [ ] **Step 2: Verify .gitignore**

The existing `.gitignore` already covers `dist/`, `node_modules/`, and `*.zip`. No changes needed.

- [ ] **Step 3: Create vitest.config.js**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.js'],
  },
});
```

- [ ] **Step 4: Create eslint.config.js**

```js
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'docs/'],
  },
];
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore vitest.config.js eslint.config.js
git commit -m "chore: add package.json, vitest, eslint, esbuild scaffolding"
```

---

### Task 2: Move source files to src/

**Files:**
- Move: `background.js` -> `src/background.js`
- Move: `popup.js` -> `src/popup.js`
- Move: `popup.html` -> `src/popup.html`
- Move: `popup.css` -> `src/popup.css`
- Move: `options.js` -> `src/options.js`
- Move: `options.html` -> `src/options.html`
- Move: `options.css` -> `src/options.css`
- Move: `platforms/common.js` -> `src/platforms/common.js`
- Move: `platforms/instagram.js` -> `src/platforms/instagram.js`
- Move: `platforms/twitter.js` -> `src/platforms/twitter.js`
- Move: `platforms/facebook.js` -> `src/platforms/facebook.js`
- Move: `platforms/linkedin.js` -> `src/platforms/linkedin.js`
- Move: `platforms/tiktok.js` -> `src/platforms/tiktok.js`
- Move: `platforms/youtube.js` -> `src/platforms/youtube.js`

- [ ] **Step 1: Create src/ directory structure**

```bash
mkdir -p src/platforms
```

- [ ] **Step 2: Move all source files**

```bash
git mv background.js src/background.js
git mv popup.js src/popup.js
git mv popup.html src/popup.html
git mv popup.css src/popup.css
git mv options.js src/options.js
git mv options.html src/options.html
git mv options.css src/options.css
git mv platforms/common.js src/platforms/common.js
git mv platforms/instagram.js src/platforms/instagram.js
git mv platforms/twitter.js src/platforms/twitter.js
git mv platforms/facebook.js src/platforms/facebook.js
git mv platforms/linkedin.js src/platforms/linkedin.js
git mv platforms/tiktok.js src/platforms/tiktok.js
git mv platforms/youtube.js src/platforms/youtube.js
rmdir platforms
```

- [ ] **Step 3: Commit the move (before any edits)**

```bash
git add -A
git commit -m "refactor: move source files to src/ directory"
```

Committing the move separately preserves git file history tracking.

**Note:** `linkedin.js`, `tiktok.js`, and `youtube.js` are moved but NOT converted to ESM in this plan. They still reference the old `SocialSnag.init()` / `SocialSnag.registerResolver()` pattern from the removed global object. They will not work until they are converted in a future PR. This is intentional — they are excluded from the manifest and the build. Add a TODO comment at the top of each during the move: `// TODO: convert to ESM imports when re-enabling this platform`.

---

### Task 3: Convert src/platforms/common.js to ESM

**Files:**
- Modify: `src/platforms/common.js`

This is the foundation — all other files import from here. Convert the `SocialSnag` object to named exports.

- [ ] **Step 1: Rewrite common.js as ESM**

Replace the `SocialSnag` object with named exports. The file should export:

```js
export const ALLOWED_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
];

export function isAllowedDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => {
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch (e) {
    return false;
  }
}

export function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

export function sanitizeFilename(name) {
  if (!name) return null;
  return name
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

export function extractId(url, pattern) {
  const match = url.match(pattern);
  return match ? match[1] : null;
}

export function findPostContainer(element, selectors) {
  let el = element;
  while (el && el !== document.body) {
    for (const selector of selectors) {
      if (el.matches(selector)) return el;
    }
    el = el.parentElement;
  }
  return null;
}

export function collectMediaInContainer(container) {
  const items = [];
  if (!container) return items;

  container.querySelectorAll('img').forEach((img) => {
    const src = img.src || img.dataset.src || '';
    if (src && !src.startsWith('data:')) {
      items.push({ url: src, type: 'image', element: img });
    }
  });

  container.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src || '';
    if (src && !src.startsWith('blob:')) {
      items.push({ url: src, type: 'video', element: video });
    }
  });

  return items;
}

export function findNearestMedia(element) {
  if (!element) return null;

  if (element.tagName === 'IMG') return element;
  if (element.tagName === 'VIDEO') return element;

  const img = element.querySelector('img');
  if (img) return img;
  const video = element.querySelector('video');
  if (video) return video;

  let el = element;
  for (let i = 0; i < 5 && el && el !== document.body; i++) {
    el = el.parentElement;
    if (!el) break;
    const nearImg = el.querySelector('img');
    if (nearImg && nearImg.src && !nearImg.src.startsWith('data:')) return nearImg;
    const nearVideo = el.querySelector('video');
    if (nearVideo) return nearVideo;
  }

  return null;
}

export async function getCapturedMedia() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getCapturedMedia' }, (response) => {
      resolve(response?.urls || []);
    });
  });
}
```

Remove the old `SocialSnag` object wrapper entirely. No `init()` or `registerResolver()` — those move into each platform script.

- [ ] **Step 2: Commit**

```bash
git add src/platforms/common.js
git commit -m "refactor: convert common.js to ESM exports"
```

---

### Task 4: Convert src/platforms/instagram.js to ESM

**Files:**
- Modify: `src/platforms/instagram.js`

- [ ] **Step 1: Rewrite instagram.js**

Key changes:
- Import from `./common.js`
- Export pure functions: `upgradeImageUrl`, `extractShortcode`, `parseMediaFromJson`
- `extractShortcode(pathname)` takes pathname as arg (not `window.location`)
- `parseMediaFromJson(jsonStrings)` takes array of strings (not `document.querySelectorAll`)
- Browser glue in `initContentScript()` with auto-init guard

```js
import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

// Pure functions -- exported for testing

export function upgradeImageUrl(url, imgElement) {
  if (!url || !url.includes('cdninstagram.com')) return null;

  if (imgElement?.srcset) {
    const candidates = imgElement.srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      const width = parseInt(parts[1]) || 0;
      return { url: parts[0], width };
    });
    candidates.sort((a, b) => b.width - a.width);
    if (candidates.length > 0 && candidates[0].url) {
      return candidates[0].url;
    }
  }

  return url.replace(/\/s\d+x\d+\//, '/');
}

export function extractShortcode(pathname) {
  const match = pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

export function parseMediaFromJson(jsonStrings) {
  const items = [];
  for (const text of jsonStrings) {
    try {
      const data = JSON.parse(text);
      if (data.image) {
        const images = Array.isArray(data.image) ? data.image : [data.image];
        images.forEach((imgUrl, i) => {
          items.push({
            url: imgUrl,
            type: 'image',
            filename: `json_${i + 1}`,
          });
        });
      }
    } catch (e) { /* ignore malformed JSON */ }
  }
  return items;
}

// Browser wiring -- below this line, functions use DOM/chrome APIs

function extractFromPageJson(pathname) {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const items = parseMediaFromJson([...scripts].map((s) => s.textContent));
  const shortcode = extractShortcode(pathname);
  return items.map((item, i) => ({
    ...item,
    filename: shortcode ? `post_${shortcode}_${i + 1}` : item.filename,
  }));
}

function resolveSingle(srcUrl, target, pathname) {
  const url = upgradeImageUrl(srcUrl, target);
  if (url) {
    const shortcode = extractShortcode(pathname);
    return [{ url, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
  }

  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeImageUrl(nearest.src, nearest);
    if (upgraded) {
      const shortcode = extractShortcode(pathname);
      return [{ url: upgraded, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      const shortcode = extractShortcode(pathname);
      return [{ url: src, type: 'video', filename: shortcode ? `reel_${shortcode}` : null }];
    }
  }

  return [];
}

async function resolveAll(target, pathname) {
  const jsonItems = extractFromPageJson(pathname);
  if (jsonItems.length > 0) return jsonItems;

  const post = findPostContainer(target, [
    'article',
    '[role="presentation"]',
    'div._aagv',
  ]);
  if (!post) return resolveSingle(target?.src || '', target, pathname);

  const items = [];
  const shortcode = extractShortcode(pathname);
  let index = 1;

  post.querySelectorAll('img[src*="cdninstagram.com"]').forEach((img) => {
    const url = upgradeImageUrl(img.src, img);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    }
  });

  post.querySelectorAll('video').forEach((video) => {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      items.push({
        url: src,
        type: 'video',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    }
  });

  if (items.length <= 1) {
    const captured = await getCapturedMedia();
    const igMedia = captured
      .filter((c) => c.url.includes('cdninstagram.com') && c.type === 'image')
      .slice(-10);

    igMedia.forEach((c) => {
      if (!items.some((i) => i.url === c.url)) {
        items.push({
          url: c.url,
          type: 'image',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        });
        index++;
      }
    });
  }

  return items.length > 0 ? items : resolveSingle(target?.src || '', target, pathname);
}

// Content script bootstrap
function initContentScript() {
  let lastTarget = null;
  document.addEventListener('contextmenu', (e) => {
    lastTarget = e.target;
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      const pathname = window.location.pathname;
      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, lastTarget, pathname)
        : resolveAll(lastTarget, pathname);

      Promise.resolve(handler)
        .then((urls) => sendResponse({ urls: urls || [], platform: 'instagram' }))
        .catch((err) => {
          console.error('SocialSnag instagram error:', err);
          sendResponse({ urls: [], platform: 'instagram' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platforms/instagram.js
git commit -m "refactor: convert instagram.js to ESM with testable pure functions"
```

---

### Task 5: Convert src/platforms/twitter.js to ESM

**Files:**
- Modify: `src/platforms/twitter.js`

- [ ] **Step 1: Rewrite twitter.js**

Key changes:
- Import from `./common.js`
- Export pure functions: `upgradeImageUrl`, `filterCapturedVideos`
- Extract `filterCapturedVideos(captured)` from `resolveVideo()` -- pure filter/sort logic
- `extractTweetId` stays internal (needs DOM)
- Browser glue in `initContentScript()` with auto-init guard

```js
import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

// Pure functions -- exported for testing

export function upgradeImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
      u.searchParams.set('name', 'orig');
      return u.toString();
    }
    if (u.hostname === 'pbs.twimg.com' && u.pathname.includes('/profile_images/')) {
      return url.replace(/_(normal|bigger|mini|200x200|400x400)\./i, '.');
    }
  } catch (e) { /* ignore */ }
  return url.includes('twimg.com') ? url : null;
}

export function filterCapturedVideos(captured) {
  return captured
    .filter((c) => c.url.includes('video.twimg.com') && c.url.includes('.mp4'))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// Browser wiring

function extractTweetId(target) {
  const tweet = findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
  ]);
  if (!tweet) return null;

  const link = tweet.querySelector('a[href*="/status/"]');
  if (link) {
    const match = link.href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

function resolveSingle(srcUrl, target) {
  const url = upgradeImageUrl(srcUrl);
  if (url) {
    const id = extractTweetId(target);
    return [{ url, type: 'image', filename: id ? `tweet_${id}` : null }];
  }

  const nearestMedia = findNearestMedia(target);
  if (nearestMedia) {
    if (nearestMedia.tagName === 'IMG') {
      const upgraded = upgradeImageUrl(nearestMedia.src);
      if (upgraded) {
        const id = extractTweetId(target);
        return [{ url: upgraded, type: 'image', filename: id ? `tweet_${id}` : null }];
      }
    }
    if (nearestMedia.tagName === 'VIDEO') {
      return resolveVideo();
    }
  }

  if (target?.tagName === 'VIDEO' || target?.closest('video')) {
    return resolveVideo();
  }

  return resolveAll(target);
}

function resolveAll(target) {
  const tweet = findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    '[data-testid="tweet"]',
  ]);
  if (!tweet) return resolveSingle(target?.src || '', target);

  const items = [];
  const id = extractTweetId(target);
  let index = 1;

  tweet.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
    const url = upgradeImageUrl(img.src);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: id ? `tweet_${id}_${index}` : null,
      });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

async function resolveVideo() {
  const captured = await getCapturedMedia();
  const mp4s = filterCapturedVideos(captured);
  if (mp4s.length > 0) {
    return [{ url: mp4s[0].url, type: 'video', filename: null }];
  }
  return [];
}

function initContentScript() {
  let lastTarget = null;
  document.addEventListener('contextmenu', (e) => {
    lastTarget = e.target;
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, lastTarget)
        : resolveAll(lastTarget);

      Promise.resolve(handler)
        .then((urls) => sendResponse({ urls: urls || [], platform: 'twitter' }))
        .catch((err) => {
          console.error('SocialSnag twitter error:', err);
          sendResponse({ urls: [], platform: 'twitter' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platforms/twitter.js
git commit -m "refactor: convert twitter.js to ESM with testable pure functions"
```

---

### Task 6: Convert src/platforms/facebook.js to ESM

**Files:**
- Modify: `src/platforms/facebook.js`

- [ ] **Step 1: Rewrite facebook.js**

Key changes:
- Import from `./common.js`
- Export pure functions: `upgradeUrl`, `extractPhotoId`, `extractVideoUrlFromScripts`
- `extractVideoUrlFromScripts(scriptTexts)` takes array of strings (not `document.querySelectorAll`)
- Browser glue in `initContentScript()` with auto-init guard

```js
import { findNearestMedia, findPostContainer, getCapturedMedia } from './common.js';

// Pure functions -- exported for testing

export function upgradeUrl(url) {
  if (!url || !url.includes('fbcdn.net')) return null;
  return url.replace(/\/[sp]\d+x\d+\//, '/');
}

export function extractPhotoId(url) {
  if (!url) return null;
  const match = url.match(/\/(\d{10,})/);
  return match ? match[1] : null;
}

export function extractVideoUrlFromScripts(scriptTexts) {
  for (const text of scriptTexts) {
    if (text.includes('playable_url_quality_hd')) {
      const match = text.match(/"playable_url_quality_hd":"(https?:[^"]+)"/);
      if (match) return match[1].replace(/\\\//g, '/');
    }
    if (text.includes('playable_url')) {
      const match = text.match(/"playable_url":"(https?:[^"]+)"/);
      if (match) return match[1].replace(/\\\//g, '/');
    }
  }
  return null;
}

// Browser wiring

function findVideoUrl(target) {
  const container = target?.closest('[role="article"]') || target?.parentElement;
  if (!container) return null;

  const video = container.querySelector('video');
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) return src;
  }

  const scripts = document.querySelectorAll('script');
  return extractVideoUrlFromScripts([...scripts].map((s) => s.textContent));
}

function resolveSingle(srcUrl, target) {
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPhotoId(srcUrl);
    return [{ url, type: 'image', filename: id ? `photo_${id}` : null }];
  }

  const nearest = findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPhotoId(nearest.src);
      return [{ url: upgraded, type: 'image', filename: id ? `photo_${id}` : null }];
    }
  }

  const videoUrl = findVideoUrl(target);
  if (videoUrl) {
    return [{ url: videoUrl, type: 'video', filename: null }];
  }

  return [];
}

async function resolveAll(target) {
  const post = findPostContainer(target, [
    '[role="article"]',
    '[data-pagelet*="FeedUnit"]',
    '[data-pagelet*="ProfileTimeline"]',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  let index = 1;

  post.querySelectorAll('img[src*="fbcdn.net"]').forEach((img) => {
    const url = upgradeUrl(img.src);
    if (url) {
      if (img.width > 50 || img.naturalWidth > 50 || !img.width) {
        const id = extractPhotoId(img.src);
        items.push({
          url,
          type: 'image',
          filename: id ? `photo_${id}_${index}` : null,
        });
        index++;
      }
    }
  });

  if (items.length === 0) {
    const captured = await getCapturedMedia();
    const fbImages = captured
      .filter((c) => c.url.includes('fbcdn.net') && c.type === 'image')
      .slice(-5);

    fbImages.forEach((c) => {
      items.push({
        url: c.url,
        type: 'image',
        filename: `photo_${index}`,
      });
      index++;
    });
  }

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function initContentScript() {
  let lastTarget = null;
  document.addEventListener('contextmenu', (e) => {
    lastTarget = e.target;
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'resolve') {
      const handler = message.type === 'single'
        ? resolveSingle(message.srcUrl, lastTarget)
        : resolveAll(lastTarget);

      Promise.resolve(handler)
        .then((urls) => sendResponse({ urls: urls || [], platform: 'facebook' }))
        .catch((err) => {
          console.error('SocialSnag facebook error:', err);
          sendResponse({ urls: [], platform: 'facebook' });
        });
      return true;
    }
  });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.id) {
  initContentScript();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platforms/facebook.js
git commit -m "refactor: convert facebook.js to ESM with testable pure functions"
```

---

### Task 7: Convert src/background.js to ESM

**Files:**
- Modify: `src/background.js`

- [ ] **Step 1: Rewrite background.js**

Key changes:
- Import `ALLOWED_DOMAINS` from `./platforms/common.js` (single source of truth)
- Export pure functions: `detectPlatform`, `guessExtension`, `validateDownloadUrl`, `sanitizeDownloadPath`
- Extract `validateDownloadUrl(url)` from `downloadMedia()` -- combines HTTPS check + domain allowlist
- Chrome API wiring stays in file, uses the exported pure functions internally

```js
import { ALLOWED_DOMAINS } from './platforms/common.js';

// Pure functions -- exported for testing

const SUPPORTED_URL_PATTERNS = [
  '*://*.instagram.com/*',
  '*://*.twitter.com/*',
  '*://*.x.com/*',
  '*://*.facebook.com/*',
];

const CDN_PATTERNS = [
  '*://*.cdninstagram.com/*',
  '*://*.twimg.com/*',
  '*://*.fbcdn.net/*',
];

const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
const MENU_DOWNLOAD_ALL = 'socialsnag-download-all';

export function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
  return null;
}

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

export function validateDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { valid: false, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'non-HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    return { valid: false, reason: 'untrusted domain' };
  }

  return { valid: true };
}

export function sanitizeDownloadPath(rawFilename, platform, ext) {
  const filename = (rawFilename || `${Date.now()}`)
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return `SocialSnag/${platform}/${filename}${ext}`;
}

// Chrome API wiring -- below this line, all functions use chrome.*

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialSnag',
    message: message,
  });
}

async function downloadMedia(item, platform) {
  if (!item.url) return null;

  const validation = validateDownloadUrl(item.url);
  if (!validation.valid) {
    console.warn(`SocialSnag: rejected download -- ${validation.reason}`);
    return null;
  }

  const ext = guessExtension(item.url, item.type);
  const path = sanitizeDownloadPath(item.filename, platform, ext);

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

  if (downloadHistory.length > 50) {
    downloadHistory.splice(0, downloadHistory.length - 50);
  }

  await chrome.storage.local.set({ downloadHistory });
}

// Event listeners

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
  initAdvancedMode();
});

chrome.runtime.onStartup.addListener(initAdvancedMode);

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
  if (urls.length > 50) urls.splice(0, urls.length - 50);
  await chrome.storage.session.set({ [key]: urls });
}

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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `captured_${tabId}`;
  await chrome.storage.session.remove(key);
});

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
```

- [ ] **Step 2: Commit**

```bash
git add src/background.js
git commit -m "refactor: convert background.js to ESM, deduplicate domain allowlist"
```

---

### Task 8: Convert src/popup.js and src/options.js to ESM

**Files:**
- Modify: `src/popup.js`
- Modify: `src/options.js`

- [ ] **Step 1: Convert popup.js**

Add `export` to `relativeTime`. Wrap all DOM code (`renderPlatforms`, `renderHistory`, `DOMContentLoaded` listener, button click handlers) inside an `initPopup()` function with a `typeof document !== 'undefined'` guard — same pattern as the platform content scripts. Without this guard, importing `popup.js` in Vitest will throw `ReferenceError: document is not defined` because `document.addEventListener('DOMContentLoaded', ...)` runs at module scope.

```js
export function relativeTime(ts) { /* unchanged */ }

function initPopup() {
  // All existing DOM code moves here:
  // - DOMContentLoaded listener
  // - renderPlatforms()
  // - renderHistory()
  // - btn-settings and btn-clear click handlers
}

if (typeof document !== 'undefined') {
  initPopup();
}
```

- [ ] **Step 2: Convert options.js**

No exports needed. Verify it has no `require()` calls (it doesn't). It's already valid ESM as-is since it only uses Chrome APIs.

- [ ] **Step 3: Commit**

```bash
git add src/popup.js src/options.js
git commit -m "refactor: convert popup.js and options.js to ESM"
```

---

### Task 9: Create build.js (esbuild)

**Files:**
- Create: `build.js`

- [ ] **Step 1: Write build.js**

```js
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';

const isZip = process.argv.includes('--zip');

// Clean dist/
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/platforms', { recursive: true });

// Bundle JS entry points
const entryPoints = [
  { in: 'src/background.js', out: 'background' },
  { in: 'src/platforms/instagram.js', out: 'platforms/instagram' },
  { in: 'src/platforms/twitter.js', out: 'platforms/twitter' },
  { in: 'src/platforms/facebook.js', out: 'platforms/facebook' },
  { in: 'src/popup.js', out: 'popup' },
  { in: 'src/options.js', out: 'options' },
];

await esbuild.build({
  entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  minify: isZip,
  target: ['chrome116'],
});

// Copy static assets
cpSync('icons', 'dist/icons', { recursive: true });
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/popup.css', 'dist/popup.css');
cpSync('src/options.html', 'dist/options.html');
cpSync('src/options.css', 'dist/options.css');

// Rewrite manifest: remove common.js from content_scripts
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.content_scripts = manifest.content_scripts.map((cs) => ({
  ...cs,
  js: cs.js.filter((f) => f !== 'platforms/common.js'),
}));
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));

console.log('Build complete: dist/');

// Optional: create zip for CWS
if (isZip) {
  const version = manifest.version;
  const zipName = `socialsnag-${version}.zip`;
  execFileSync('zip', ['-r', `../${zipName}`, '.'], { cwd: 'dist' });
  console.log(`Zip created: ${zipName}`);
}
```

- [ ] **Step 2: Run the build**

Run: `node build.js`

Expected: `dist/` created with all bundled files. Verify:
```bash
ls dist/
# background.js  icons/  manifest.json  options.css  options.html  options.js
# platforms/  popup.css  popup.html  popup.js
ls dist/platforms/
# facebook.js  instagram.js  twitter.js
```

- [ ] **Step 3: Verify manifest was rewritten correctly**

Run: `node --input-type=commonjs -e "const m = JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8')); m.content_scripts.forEach(cs => console.log(cs.js))"`

Expected: Each content_scripts entry has only one JS file (no `platforms/common.js`).

- [ ] **Step 4: Commit**

```bash
git add build.js
git commit -m "feat: add esbuild build script with manifest rewrite and zip support"
```

---

### Task 10: Create test infrastructure

**Files:**
- Create: `test/chrome-mock.js`
- Create: `test/setup.js`

- [ ] **Step 1: Write test/chrome-mock.js**

```js
function createStorageArea() {
  let data = {};
  return {
    get: async (keys) => {
      if (typeof keys === 'string') {
        return { [keys]: data[keys] };
      }
      const result = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = key in data ? data[key] : defaultValue;
      }
      return result;
    },
    set: async (items) => {
      Object.assign(data, items);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach((k) => delete data[k]);
    },
    _reset: () => { data = {}; },
    _data: () => ({ ...data }),
  };
}

globalThis.chrome = {
  storage: {
    sync: createStorageArea(),
    local: createStorageArea(),
    session: createStorageArea(),
  },
  runtime: {
    id: 'test-extension-id',
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: (_msg, callback) => {
      if (callback) callback({ urls: [] });
    },
  },
  notifications: {
    create: () => {},
  },
};
```

- [ ] **Step 2: Write test/setup.js**

```js
import './chrome-mock.js';
```

- [ ] **Step 3: Commit**

```bash
mkdir -p test
git add test/chrome-mock.js test/setup.js
git commit -m "test: add Chrome API mock and vitest setup"
```

---

### Task 11: Write tests -- common.js

**Files:**
- Create: `test/common.test.js`
- Test: `src/platforms/common.js`

- [ ] **Step 1: Write test/common.test.js**

Test all pure functions: `isAllowedDomain` (including dot-boundary attack), `isHttps`, `sanitizeFilename` (path traversal, special chars, null), `extractId`, `findNearestMedia` (with element stubs).

See spec for full test case list. Key security test:
```js
it('rejects domain with matching suffix but no dot boundary', () => {
  expect(isAllowedDomain('https://evilcdninstagram.com/image.jpg')).toBe(false);
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/common.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/common.test.js
git commit -m "test: add common.js unit tests"
```

---

### Task 12: Write tests -- background.js

**Files:**
- Create: `test/background.test.js`
- Test: `src/background.js`

- [ ] **Step 1: Write test/background.test.js**

Test: `detectPlatform` (each platform + null + empty), `guessExtension` (video type, format param, path extension, fallback), `validateDownloadUrl` (HTTPS, domain allowlist, dot-boundary bypass, malformed), `sanitizeDownloadPath` (path assembly, traversal, special chars, null filename).

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/background.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/background.test.js
git commit -m "test: add background.js unit tests"
```

---

### Task 13: Write tests -- instagram.js

**Files:**
- Create: `test/instagram.test.js`
- Test: `src/platforms/instagram.js`

- [ ] **Step 1: Write test/instagram.test.js**

Test: `upgradeImageUrl` (srcset highest width, size removal, non-IG null), `extractShortcode` (/p/, /reel/, /tv/, no match), `parseMediaFromJson` (single image, array, malformed JSON, no image field, empty).

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/instagram.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/instagram.test.js
git commit -m "test: add instagram.js unit tests"
```

---

### Task 14: Write tests -- twitter.js

**Files:**
- Create: `test/twitter.test.js`
- Test: `src/platforms/twitter.js`

- [ ] **Step 1: Write test/twitter.test.js**

Test: `upgradeImageUrl` (name=orig, profile pic suffix removal, non-twimg null), `filterCapturedVideos` (filter by domain+extension, sort by timestamp desc, empty array).

**Note:** The spec mentions testing `extractTweetId` with a DOM mock, but it is intentionally kept as a private function (it requires a real DOM article container with nested links). Testing it would require JSDOM or a complex mock setup that provides false confidence. Skipped by design.

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/twitter.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/twitter.test.js
git commit -m "test: add twitter.js unit tests"
```

---

### Task 15: Write tests -- facebook.js

**Files:**
- Create: `test/facebook.test.js`
- Test: `src/platforms/facebook.js`

- [ ] **Step 1: Write test/facebook.test.js**

Test: `upgradeUrl` (size removal, non-fbcdn null), `extractPhotoId` (10+ digit ID, short numbers null, null), `extractVideoUrlFromScripts` (HD url, SD fallback, HD preferred, escaped slashes, no match, empty).

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/facebook.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/facebook.test.js
git commit -m "test: add facebook.js unit tests"
```

---

### Task 16: Write tests -- popup.js

**Files:**
- Create: `test/popup.test.js`
- Test: `src/popup.js`

- [ ] **Step 1: Write test/popup.test.js**

Test: `relativeTime` (now, minutes, hours, days boundary values).

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/popup.test.js`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/popup.test.js
git commit -m "test: add popup.js unit tests"
```

---

### Task 17: Run full test suite and lint

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: All tests pass across all 6 test files.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: No errors. Fix any lint issues in the source files.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: `dist/` produced. Verify `dist/manifest.json` has no `platforms/common.js` in content_scripts.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "fix: address lint issues"
```

(Skip if lint passed clean.)

---

### Task 18: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

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
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for lint, test, and build"
```

---

### Task 19: Generate CWS screenshots on officejawn

**Files:**
- Create: `store/screenshots/` (output directory)
- Create: `store/generate-screenshots.js` (Playwright script, run on officejawn)

This task requires SSH to officejawn and runs interactively. The Playwright script creates mock HTML pages that simulate social media layouts, loads the extension, and captures 1280x800 screenshots.

- [ ] **Step 1: Write the screenshot generator script**

Create `store/generate-screenshots.js` -- a Playwright script that:
1. Builds the extension (runs `node build.js`)
2. Launches Chromium with `--load-extension=dist/` and `--window-size=1280,800`
3. For each of the 5 required screenshots:
   - Navigates to a mock HTML page (created as data URLs or local files)
   - Injects the extension UI elements via DOM
   - Takes a 1280x800 screenshot
4. Saves to `store/screenshots/1-instagram-context-menu.png` through `5-folder-structure.png`

- [ ] **Step 2: SSH to officejawn, install deps, run the script**

```bash
ssh officejawn "cd ~/projects/socialsnag && npm install && node store/generate-screenshots.js"
```

- [ ] **Step 3: Copy screenshots back to houseofjawn**

```bash
scp officejawn:~/projects/socialsnag/store/screenshots/*.png ~/projects/socialsnag/store/screenshots/
```

- [ ] **Step 4: Commit**

```bash
git add store/screenshots/ store/generate-screenshots.js
git commit -m "feat: add CWS screenshots generated via Playwright"
```

---

### Task 20: Create PR

- [ ] **Step 1: Push the feature branch**

The feature branch was created in Task 0. Push it:

```bash
git push -u origin feature/esm-tests-ci
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat: ESM migration, test suite, CI, and CWS screenshots" --body "$(cat <<'EOF'
## Summary
- Migrated all source files to ESM with esbuild bundling (src/ -> dist/)
- Added Vitest test suite covering all pure functions (6 test files)
- Set up GitHub Actions CI (lint + test + build on PRs)
- Generated Chrome Web Store screenshots via Playwright

## Test plan
- [ ] Run `npm test` -- all tests pass
- [ ] Run `npm run build` -- dist/ produced, manifest rewritten correctly
- [ ] Load `dist/` as unpacked extension in Chrome -- context menu works on Instagram/Twitter/Facebook
- [ ] Run `npm run lint` -- no errors
EOF
)"
```

- [ ] **Step 3: Wait for Copilot review**

Do NOT merge. Wait for Copilot review comments and Joe's approval.
