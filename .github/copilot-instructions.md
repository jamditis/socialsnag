# SocialSnag — Copilot review context

## Architecture

SocialSnag is a Chrome extension (Manifest V3) that downloads HD media from social platforms via right-click context menu.

**Components:**

- `background.js` — service worker. Registers context menu items, handles menu clicks, validates URLs against a domain allowlist, triggers downloads, records download history.
- `platforms/common.js` — shared utilities loaded before each platform script. Provides `SocialSnag.init()` (sets up contextmenu listener + message handler) and `SocialSnag.registerResolver()` (registers the platform's resolve function). Also includes domain validation, filename sanitization, and media element traversal helpers.
- `platforms/<platform>.js` — per-platform content scripts (instagram, twitter, facebook). Each calls `SocialSnag.init()` then `SocialSnag.registerResolver()` with a handler that returns `{ urls, platform }`.
- `popup.js` / `popup.html` — popup UI showing platform toggles and download history.
- `options.js` / `options.html` — full options page with platform toggles and advanced mode.

## Message passing

1. User right-clicks on a supported site.
2. Background receives context menu click, sends `{ action: 'resolve', type: 'single'|'all', srcUrl, pageUrl }` to the active tab's content script.
3. Content script's registered resolver extracts media URLs from the page DOM.
4. Content script responds with `{ urls: [...], platform: 'instagram'|'twitter'|'facebook' }`.
5. Background validates each URL (HTTPS + domain allowlist), downloads, and records to history.

## Platform resolver pattern

Each platform script follows the same structure:

```js
SocialSnag.init('platformName');
SocialSnag.registerResolver(async (message, target) => {
  // Extract and return media URLs
  return [{ url, type, filename }];
});
```

Platform scripts rewrite CDN URLs to request the highest available resolution (e.g., removing size parameters from Instagram CDN URLs, requesting `?name=orig` on Twitter).

## Key review flags

Watch for these in PRs:

- **innerHTML or insertAdjacentHTML usage** — XSS risk. All DOM construction should use `createElement` + `textContent`. Flag any raw HTML insertion.
- **URL validation bypass** — Downloads must pass both `isHttps()` and domain allowlist checks (in both `common.js` and `background.js`). New URL patterns that skip validation are a security issue.
- **New host_permissions** — Any addition to `host_permissions` in manifest.json must be justified. Prefer `optional_host_permissions` for non-core platforms.
- **Permission creep** — New entries in the `permissions` array need clear justification. The extension should request the minimum permissions required.
- **Sensitive data in chrome.storage** — Storage should only contain download history (filenames, timestamps, platform names) and user preferences. No tokens, credentials, or PII.
- **Unsanitized filenames** — All filenames must pass through `sanitizeFilename()` before use in download paths. Watch for path traversal (`../`).
- **Direct network requests to non-CDN domains** — The extension should only fetch from known CDN domains. Any `fetch()` or `XMLHttpRequest` to other domains needs scrutiny.
