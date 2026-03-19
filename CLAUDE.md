# CLAUDE.md

## What this is

SocialSnag — Chrome extension (Manifest V3) that downloads full-resolution images and videos from social media via right-click context menu.

**Repo:** https://github.com/jamditis/socialsnag (public)
**Version:** 1.0.0
**Author:** Joe Amditis

## Architecture

```
background.js          — service worker: context menu, downloads, URL validation, download history, optional webRequest
platforms/common.js    — shared SocialSnag object: init(), registerResolver(), DOM helpers, security helpers
platforms/instagram.js — Instagram resolver (srcset upgrade, JSON extraction, carousel support)
platforms/twitter.js   — Twitter/X resolver (name=orig rewrite, profile pic upgrade)
platforms/facebook.js  — Facebook resolver (fbcdn upgrade, video extraction from scripts)
platforms/linkedin.js  — LinkedIn resolver (shrink param removal) — NOT in manifest, optional only
platforms/tiktok.js    — TikTok resolver (rehydration JSON) — NOT in manifest, optional only
platforms/youtube.js   — YouTube resolver (maxres thumbnail) — NOT in manifest, fully excluded
popup.html/js/css      — popup UI: platform badges, download history
options.html/js/css    — settings: platform toggles, advanced mode, disclaimer
```

### Message flow

1. User right-clicks on supported site
2. Background receives `contextMenus.onClicked`, calls `chrome.tabs.sendMessage({ action: 'resolve' })`
3. Content script's registered resolver finds media URLs in the DOM
4. Content script responds with `{ urls: [...], platform: '...' }`
5. Background validates each URL (HTTPS, domain allowlist, dot-boundary check), sanitizes filename, downloads
6. Background records download to `chrome.storage.local` history

### Platform resolver pattern

Each platform script calls `SocialSnag.init('platformName')` then `SocialSnag.registerResolver(handler)`. The handler receives `(message, lastRightClickTarget)` and returns an array of `{ url, type, filename }` objects.

### Storage areas

- `chrome.storage.sync` — user preferences (platform toggles, notification setting, advancedMode flag). Syncs to Google if Chrome sync is on.
- `chrome.storage.local` — download history (max 50 entries, pruned on write). Device-specific.
- `chrome.storage.session` — captured media URLs from webRequest (ephemeral, survives service worker restarts but not browser restarts).

## Chrome Web Store compliance

### Platforms included in CWS submission
Instagram, Twitter/X, Facebook only.

### Platforms excluded
- **YouTube** — fully removed from manifest. Google removes YT download extensions. No optional support.
- **LinkedIn** — code in repo, host patterns in `optional_host_permissions`. Medium-high rejection risk.
- **TikTok** — code in repo, host patterns in `optional_host_permissions`. Medium-high rejection risk.

### Permission model
- Core: `contextMenus`, `downloads`, `activeTab`, `storage`, `notifications`, `scripting`
- Optional: `webRequest` (toggled via "advanced mode" in settings)
- Host permissions (upfront): Instagram + CDN, Twitter/X + CDN, Facebook + CDN
- Optional host permissions: LinkedIn + CDN, TikTok + CDN

### Security requirements
- **Domain allowlist with dot-boundary check** — `hostname === d || hostname.endsWith('.'+d)`. Plain `endsWith` allows `evilcdninstagram.com` bypass.
- **HTTPS only** — reject non-HTTPS download URLs
- **Filename sanitization** — strip `../`, `..\`, and `<>:"/\|?*` characters
- **Sender validation** — `sender.id === chrome.runtime.id` on all background onMessage handlers
- **No innerHTML** — all DOM rendering uses `textContent`
- **No remote code** — everything bundled, no external scripts
- **No URL storage** — download history stores filename/platform/timestamp, NOT the CDN URL (may contain signed auth tokens)

## Development

### Load the extension
1. `chrome://extensions` > Developer mode > Load unpacked > select this folder

### Key files to check after changes
- `manifest.json` — permissions, content_scripts, version
- `background.js` — the security gate (URL validation happens here)
- `platforms/common.js` — shared domain allowlist (must match background.js)

### No build step
Plain JS, no bundler. Edit and reload in Chrome.

### No test framework yet
Manual testing only. Automated tests are planned as follow-up work.

## Current status and next steps

### Done
- v1.0.0 public release with security hardening
- Popup UI with download history
- Options page with advanced mode toggle
- OG image, README badges, CWS listing assets
- Copilot review addressed (13/13 comments)

### Pending (requires Joe)
- Upload social preview image in GitHub Settings > General > Social preview
- Register Chrome Web Store developer account ($5 one-time)
- Take 5 screenshots on a machine with Chrome (guide in `store/screenshot-guide.md`)
- Create zip: `zip -r /tmp/socialsnag-1.0.0.zip . -x "docs/*" "store/*" ".git/*" ".github/*" "*.md"`
- Upload to CWS developer dashboard, fill in listing, submit for review

### Future work
- Automated test suite (unit tests for URL upgrade functions)
- CI via GitHub Actions
- LinkedIn/TikTok re-evaluation after initial CWS approval
