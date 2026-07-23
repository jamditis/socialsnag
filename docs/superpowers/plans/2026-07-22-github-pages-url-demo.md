# GitHub Pages URL demo implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superjawn:subagent-driven-development (recommended) or superjawn:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prominent landing-page form that sends a supported social post URL to the installed SocialSnag extension, starts authenticated local downloads, and explains every failure in the page.

**Architecture:** The static GitHub Pages site uses Chrome's externally connectable messaging API to send one tightly scoped request to the published extension ID. The extension validates both the page that sent the message and the submitted post URL, resolves the post inside the user's browser session, downloads validated CDN media without returning private URLs to the web page, and returns only a status code, platform, and file count. Instagram uses its existing authenticated background API path. Twitter/X, Facebook, and Bluesky load exact post URLs in a temporary inactive tab so their existing content scripts can use the user's session and page DOM.

**Tech stack:** Manifest V3, plain JavaScript, Chrome runtime and tabs APIs, static HTML/CSS, Vitest, esbuild.

---

## Product and security requirements

- The form appears inside the opening hero, before the badges, and remains usable on mobile and with a keyboard.
- Supported submissions are exact HTTPS post/media URLs from Instagram, Twitter/X, Facebook, and Bluesky. Profile pages, settings pages, login pages, unsupported hosts, URLs with credentials or custom ports, and malformed input are rejected before a tab opens.
- Only `https://jamditis.github.io/socialsnag/` may send the external request. The extension validates the sender again in the handler.
- The extension opens the submitted post in a temporary inactive tab, waits for the page and its content script, asks the platform resolver for the page's post media, and closes the tab in every terminal path.
- The page receives no CDN URLs, cookie values, page HTML, or account data. It receives `{ ok, code, platform, count }` only.
- Every resolved media URL still passes the existing HTTPS and CDN allowlist check before download.
- Empty results explain that the user may be logged out, may lack access, or the post may be unavailable. Missing or outdated extensions receive a direct Chrome Web Store link.
- The page must expose idle, working, success, invalid URL, unsupported URL, extension missing/outdated, access/authentication, no-media, timeout, and download-failure states through visible text with `aria-live`.
- No backend, analytics, URL storage, or direct cross-origin fetch is added to the landing page.

## Task 1: Build the tested extension bridge

**Files:**

- Modify: `manifest.json`
- Modify: `src/background.js`
- Modify: `src/platforms/instagram-api.js`
- Modify: `src/platforms/twitter.js`
- Modify: `src/platforms/facebook.js`
- Modify: `src/platforms/bluesky.js`
- Modify: `test/chrome-mock.js`
- Modify: `test/background.test.js`
- Modify: `test/instagram-api.test.js`
- Modify: `test/twitter.test.js`
- Modify: `test/facebook.test.js`
- Modify: `test/bluesky.test.js`

- [ ] **Step 1: Write failing URL validation tests**

  Add table-driven tests for accepted canonical post paths and rejected schemes, hosts, host-boundary bypasses, credentials, ports, and non-post paths. Import the wished-for `parseSubmittedPageUrl()` from `src/background.js` and assert either `{ url, platform }` or a stable error code.

- [ ] **Step 2: Run the focused tests and confirm the expected failure**

  Run `npx vitest run test/background.test.js`. Expected: failure because `parseSubmittedPageUrl` is not exported.

- [ ] **Step 3: Implement the minimal URL parser**

  Add a pure `parseSubmittedPageUrl(rawUrl)` that uses `new URL()`, exact or dot-boundary host matching, HTTPS-only rules, no credentials or custom ports, and per-platform post path patterns. Normalize only harmless URL details such as fragments; do not follow redirects or accept arbitrary platform pages.

- [ ] **Step 4: Run the focused tests until green**

  Run `npx vitest run test/background.test.js`. Expected: all background tests pass.

- [ ] **Step 5: Write failing structured Instagram error tests and page-resolution tests for the DOM resolvers**

  Add a pure Instagram HTTP-status-to-code test without changing the existing human message contract. Extend the Twitter/X, Facebook, and Bluesky tests with a `resolvePage` message case. Each test DOM should contain one representative post container and verify that the page-level request chooses media from that post without a preceding right-click.

- [ ] **Step 6: Run the four platform test files and confirm the expected failures**

  Run `npx vitest run test/instagram-api.test.js test/twitter.test.js test/facebook.test.js test/bluesky.test.js`. Expected: the new status-code helper is missing, and the three new page-level tests fail because only the existing `resolve` action is handled.

- [ ] **Step 7: Implement structured Instagram errors and page-level DOM resolution**

  Add a stable Instagram status code alongside the existing user-facing message returned by the post and story resolvers. In the Twitter/X, Facebook, and Bluesky content scripts, add a small platform-specific target selector and handle `action: 'resolvePage'` by using the existing `resolveAll` path. Preserve the existing right-click message behavior and response shape.

- [ ] **Step 8: Run the platform tests until green**

  Run the four-file Vitest command from Step 6. Expected: all four files pass.

- [ ] **Step 9: Write failing external-message workflow tests**

  Extend the Chrome mock with `runtime.onMessageExternal`, `tabs.create`, `tabs.get`, `tabs.remove`, and `tabs.onUpdated`. Test allowed and rejected senders, rejected input before tab creation, tab load timeout, content-script retry, no-media/access response, partial download failure, successful multi-file download, response redaction, and tab cleanup on every exit.

- [ ] **Step 10: Run the focused workflow tests and confirm the expected failures**

  Run `npx vitest run test/background.test.js`. Expected: failures because the external listener and submitted-post workflow do not exist.

- [ ] **Step 11: Implement the external workflow**

  Add `externally_connectable.matches` for the exact GitHub Pages site. Register `runtime.onMessageExternal`, validate the exact sender origin and `/socialsnag/` path, keep the async response channel open, and route only `action: 'downloadSubmittedUrl'`. Reject concurrent jobs with `busy`. Resolve Instagram posts, reels, carousels, and active stories through the authenticated background API. For the other three platforms, implement bounded tab-load and resolver retries. Reuse `downloadMedia()` and `recordDownload()`, close every temporary tab in `finally`, cap the number of media items handled, and return stable status codes with counts but no media details.

- [ ] **Step 12: Run the bridge tests and full suite**

  Run `npx vitest run test/background.test.js test/instagram.test.js test/twitter.test.js test/facebook.test.js test/bluesky.test.js`, then `npm test`. Expected: all tests pass.

- [ ] **Step 13: Commit the extension bridge**

  Commit only the Task 1 files with a message that explains why the landing page delegates authenticated resolution to the extension.

## Task 2: Build the landing-page form and visible states

**Files:**

- Create: `docs/demo.js`
- Create: `test/demo-page.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write failing page-controller tests**

  Test the published extension ID, callback-based runtime messaging, timeout behavior, Chrome `runtime.lastError`, stable response-to-copy mapping, form input trimming, double-submit prevention, button restoration, and safe text-only status rendering. Read `docs/index.html` in one smoke test to assert the form, label, submit button, status region, install link, and module script are present.

- [ ] **Step 2: Run the focused page tests and confirm the expected failure**

  Run `npx vitest run test/demo-page.test.js`. Expected: failure because `docs/demo.js` and the form do not exist.

- [ ] **Step 3: Implement the page controller**

  Create a focused ES module that exports the pure response mapping and message wrapper, initializes the form when the DOM exists, sends `downloadSubmittedUrl` to extension ID `llbpeneloehnlaomolbalbmhjncpmnfa`, and renders state with `textContent`, semantic classes, focus management, and an `aria-live` status element.

- [ ] **Step 4: Add the prominent hero form**

  Place the form below the opening explanation and above the existing badges. Preserve the site's Syne/Outfit dark industrial style, use a strong full-width input and button, show short session/privacy guidance, provide clear focus and disabled states, and avoid decorative patterns that do not match the existing page. Update the hero copy so the right-click workflow and URL demo do not contradict each other.

- [ ] **Step 5: Add responsive and reduced-motion behavior**

  Keep the input and button usable at 320 CSS pixels, preserve visible focus, prevent status layout jumps, and avoid adding motion to the working state when reduced motion is requested.

- [ ] **Step 6: Run page tests until green**

  Run `npx vitest run test/demo-page.test.js`. Expected: all page tests pass.

- [ ] **Step 7: Commit the landing-page UI**

  Commit only the Task 2 files with a message that explains why the working demo belongs in the opening hero.

## Task 3: Update public documentation and verify the built surfaces

**Files:**

- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `docs/privacy.html`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the feature and its boundary**

  Explain that the landing-page form requires the installed current extension, runs through the user's browser session, accepts only supported post URLs, stores no submitted URL, and may fail for logged-out, private, expired, deleted, or rate-limited media. Keep GitHub Pages and Chrome Web Store deployment as separate gates.

- [ ] **Step 2: Run content and manifest checks**

  Search for stale statements that imply the landing page has no extension messaging or that every media URL is public. Confirm `manifest.json` exposes only the exact GitHub Pages match and no new warning-bearing permission.

- [ ] **Step 3: Run formatter-equivalent checks, lint, tests, and build**

  Run `npm run lint`, `npm test`, and `npm run build`. Expected: exit code 0 for all three and a built `dist/manifest.json` containing the exact `externally_connectable` rule.

- [ ] **Step 4: Inspect the page at desktop and mobile widths**

  Serve `docs/` locally, open the page in a browser, and verify the hero at desktop and mobile widths, keyboard focus order, all mocked response states, and the no-extension state. Capture screenshots as local evidence only; do not publish them unless requested.

- [ ] **Step 5: Review the complete diff and security boundary**

  Read every changed line. Confirm no submitted URL or resolved media URL is logged, stored, returned to the page, or inserted with `innerHTML`; every download still uses `validateDownloadUrl`; every temporary tab closes; and failures stay visible long enough to read.

- [ ] **Step 6: Run local Codex review to convergence**

  Follow the repository-wide review gate: 5.5/low first, then 5.6-sol/xhigh because this change crosses a web-to-extension trust boundary. Fix actionable findings within the six-round cap and re-run affected verification.

- [ ] **Step 7: Commit the documentation and verification changes**

  Commit the Task 3 files with a message that explains the authenticated, local-only contract.

## Freshness sources

- Chrome externally connectable manifest and web-page messaging: https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable and https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome cross-origin request and cookie behavior: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests and https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Chrome tabs permissions and lifecycle: https://developer.chrome.com/docs/extensions/reference/api/tabs
