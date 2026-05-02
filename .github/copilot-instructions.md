# Copilot review instructions — socialsnag

Project context, architecture, message flow, and Chrome Web Store compliance details live in [CLAUDE.md](../CLAUDE.md). Both this file and CLAUDE.md are read by Copilot code review (cap ~4,000 chars each). This file lists the rules worth named attention on every PR.

## Global rules to flag

These are Joe's user-level conventions. They live in `~/.claude/CLAUDE.md`, which Copilot's PR review bot does *not* read — so they're restated here so the bot enforces them on this repo's PRs.

- **Sentence case** in headings, UI text, and identifiers. Title Case is a regression.
- **No emojis** in source code, log messages, comments, commits, PR bodies, or any output. Plain text only.
- **No AI attribution.** Never include "Generated with Claude Code", `Co-Authored-By: Claude` trailers, or any AI/model/company attribution in PRs, commits, code, or any committed file.
- **Banned words** (delete or replace): *comprehensive, sophisticated, robust, transformative, leveraging, seamlessly, innovative, cutting-edge, state-of-the-art, holistic, synergy, ecosystem, paradigm, empower*.
- **Every HTML page must have an SVG favicon and full OG/Twitter meta tags.** (`popup.html`, `options.html`, and the landing page in `dist/`.)

## Project-specific bug classes to flag

1. **No `innerHTML` or `insertAdjacentHTML`.** All DOM construction must use `createElement` + `textContent`. Raw HTML insertion is an XSS vector regardless of source — flag any new occurrence in `src/popup.js`, `src/options.js`, or platform scripts.

2. **URL validation must run on every download.** Every URL passed to `chrome.downloads.download()` must pass `isHttps()` AND `isAllowedDomain()` with the dot-boundary check (`hostname === d || hostname.endsWith('.'+d)`). Both checks live in `src/platforms/common.js` and are called from `src/background.js`. New download paths that bypass either check are a security regression.

3. **Filename sanitization must run on every download.** All filenames must pass through `sanitizeFilename()` (strips `../`, `..\\`, and `<>:"/\\|?*`). Watch for path traversal where user-controllable strings (page titles, alt text, OG metadata) feed into filename construction.

4. **Manifest permission creep.** Any addition to `permissions` or `host_permissions` in `manifest.json` needs justification. Prefer `optional_host_permissions` for non-core platforms — CWS flags upfront permissions for sites the extension doesn't actively use.

5. **Sensitive data must not enter `chrome.storage`.** Storage holds download history (filename, platform, timestamp) and user preferences only. No tokens, credentials, PII, or CDN URLs.

6. **No fetches to non-CDN domains.** Any `fetch()` or `XMLHttpRequest` should only target hosts in `ALLOWED_DOMAINS`. New requests to other hosts need scrutiny — it's a common vector for accidental data exfiltration in extensions.

7. **Sender validation on every background `onMessage` handler.** Each handler must check `sender.id === chrome.runtime.id` to reject messages from compromised content scripts on unrelated origins.
