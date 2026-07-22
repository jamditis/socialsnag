'use strict';

import { ALLOWED_DOMAINS, sanitizeFilename, renderTemplate } from './platforms/common.js';
import { IG_APP_ID, shortcodeToMediaId, parsePostMedia, extractStoryRef, parseStoryTray, mapIgStatusToMessage } from './platforms/instagram-api.js';
import { createTracer } from './resolver-debug.js';

// Opt-in resolver tracing (#25). Off unless the user enables it in options; it
// reports which resolver path ran and the HTTP status bucket, never a media URL.
const traceResolver = createTracer({ storage: chrome.storage });
import { copyViaOffscreen, zipViaOffscreen, revokeViaOffscreen } from './offscreen-host.js';

const MENU_PARENT = 'socialsnag-parent';
const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
const MENU_DOWNLOAD_ALL = 'socialsnag-download-all';
const MENU_DOWNLOAD_ZIP = 'socialsnag-download-zip';
const MENU_COPY_URL = 'socialsnag-copy-url';

// Contexts every menu item must appear in. Chrome applies each item's own
// contexts (an omitted list defaults to ['page']), so children need this too or
// they vanish when you right-click directly on an image or video.
const MENU_CONTEXTS = ['page', 'image', 'video', 'link'];

// Supported platform URL patterns for context menu visibility
const SUPPORTED_URL_PATTERNS = [
  '*://*.instagram.com/*',
  '*://*.twitter.com/*',
  '*://*.x.com/*',
  '*://*.facebook.com/*',
  '*://*.bsky.app/*',
];

// CDN patterns for core platforms only (webRequest monitoring)
const CDN_PATTERNS = [
  '*://*.cdninstagram.com/*',
  '*://*.twimg.com/*',
  '*://*.fbcdn.net/*',
  '*://cdn.bsky.app/*',
  '*://video.bsky.app/*',
];

// --- Pure functions (exported for testing) ---

// Detect the platform from a tab URL (core platforms only)
export function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('bsky.app')) return 'bluesky';
  return null;
}

// Guess file extension
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

// Validate a download URL against HTTPS + domain allowlist
export function validateDownloadUrl(url) {
  if (!url) return { valid: false, reason: 'empty URL' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { valid: false, reason: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'non-HTTPS URL' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    return { valid: false, reason: `untrusted domain: ${parsed.hostname}` };
  }

  return { valid: true };
}

// yyyy-mm-dd in the user's own timezone.
export function formatLocalDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Resolve the base filename for an item.
//
// An unset template keeps the name the platform resolver built. The template is
// opt-in because changing what every existing user's files are called is not a
// thing to do on their behalf during an update.
//
// {postId} and {username} come from the resolver via item.meta. A resolver that does
// not supply them yet renders those tokens as nothing, which the renderer absorbs
// along with their separators rather than leaving gaps -- so a template written for
// a platform that has the data degrades to a shorter name elsewhere instead of a
// broken one.
// index defaults to 1 so {index} is genuinely always renderable, which is what lets
// validateTemplate accept `{index}` on its own. Both download paths pass a real
// position; the default is here so the promise holds even if one later forgets to.
export function resolveBaseFilename(item, platform, template, index = 1) {
  const fallback = item.filename || `${platform}_${index}`;
  if (!template) return fallback;
  const rendered = renderTemplate(template, {
    platform,
    type: item.type || 'file',
    postId: item.meta?.postId,
    username: item.meta?.username,
    index,
    // Local date, not toISOString(): that is UTC, so an evening download west of
    // UTC would be filed under tomorrow. The date a user wants in a filename is
    // the one their calendar showed when they saved it.
    date: formatLocalDate(new Date()),
  });
  // A template can render empty for an item carrying none of its tokens, which is
  // normal, and a file called nothing but its extension is not an acceptable result.
  // Say so rather than silently handing back the old name: "why is this one still
  // named the old way" is otherwise a puzzle with no clue in it.
  if (!rendered) {
    console.debug(
      `SocialSnag: template "${template}" rendered empty for this ${item.type || 'item'}; `
      + `using ${fallback}. The tokens it names are not available here.`,
    );
    return fallback;
  }
  return rendered;
}

// Build sanitized download path
export function sanitizeDownloadPath(rawFilename, platform, ext, downloadPath) {
  const filename = rawFilename
    .replace(/^[A-Za-z]:/, '')
    .replace(/\.\.[/\\]/g, '')
    .replace(/(^|[/\\])\.\.[/\\]?/g, '$1')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const folder = (downloadPath || 'SocialSnag/{platform}')
    .replace(/\{platform\}/g, platform)
    .replace(/^[A-Za-z]:/, '')
    .replace(/\.\.[/\\]/g, '')
    .replace(/(^|[/\\])\.\.[/\\]?/g, '$1')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_');
  const normalizedFolder = folder.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  return normalizedFolder + '/' + filename + ext;
}

// --- Browser wiring (not exported) ---

// Register the context menu on install. removeAll first so re-registering on an
// update never hits a duplicate-id error. The four actions nest under one
// SocialSnag parent; children inherit the parent's contexts and URL patterns.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const shared = { contexts: MENU_CONTEXTS, documentUrlPatterns: SUPPORTED_URL_PATTERNS };
    chrome.contextMenus.create({ id: MENU_PARENT, title: 'SocialSnag', ...shared });
    chrome.contextMenus.create({ id: MENU_DOWNLOAD_SINGLE, parentId: MENU_PARENT, title: 'Download this (HD)', ...shared });
    chrome.contextMenus.create({ id: MENU_DOWNLOAD_ALL, parentId: MENU_PARENT, title: 'Download all from post', ...shared });
    chrome.contextMenus.create({ id: MENU_DOWNLOAD_ZIP, parentId: MENU_PARENT, title: 'Download all as .zip', ...shared });
    chrome.contextMenus.create({ id: MENU_COPY_URL, parentId: MENU_PARENT, title: 'Copy media URL', ...shared });
  });
});

// On startup, check if advanced mode is enabled and register webRequest if so
chrome.runtime.onStartup.addListener(initAdvancedMode);
chrome.runtime.onInstalled.addListener(initAdvancedMode);

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
  // Keep last 50 per tab
  if (urls.length > 50) urls.splice(0, urls.length - 50);
  await chrome.storage.session.set({ [key]: urls });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const isCopy = info.menuItemId === MENU_COPY_URL;
  const isZipMenu = info.menuItemId === MENU_DOWNLOAD_ZIP;
  const type = (info.menuItemId === MENU_DOWNLOAD_ALL || isZipMenu) ? 'all' : 'single';

  const platform = detectPlatform(tab.url);
  if (!platform) {
    showNotification('SocialSnag does not support this site.');
    return;
  }

  // Copy needs clipboardWrite (optional, so the 1.2 update installs silently for
  // users who never copy). Request it here, BEFORE the first await: a context-menu
  // click is a user gesture, but crossing an async boundary can drop that
  // activation and make Chrome reject the prompt. request() is a silent no-op
  // that resolves true when already granted.
  if (isCopy) {
    const granted = await chrome.permissions.request({ permissions: ['clipboardWrite'] });
    if (!granted) {
      showNotification('SocialSnag: clipboard permission is needed to copy media URLs.');
      return;
    }
  }

  const platformSettings = await chrome.storage.sync.get({
    [`platform_${platform}`]: true,
    showNotifications: true,
    zipMultiPosts: false,
  });
  if (!platformSettings[`platform_${platform}`]) return;

  try {
    // Reset per click so a stale reason from a prior click can never be shown.
    lastIgError = null;
    const pageUrl = info.pageUrl || tab.url;
    let response;
    let triedIgPostApi = false;

    // Instagram: for "download all", enumerate the whole post via the API first.
    if (platform === 'instagram' && type === 'all') {
      const shortcode = pageUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[2];
      if (shortcode) {
        triedIgPostApi = true;
        const apiItems = await resolveInstagramPost(shortcode);
        if (apiItems && apiItems.length) {
          response = { urls: apiItems, platform };
        }
      }
    }

    // Instagram stories: resolve via the reels_media API (no DOM path exists).
    if (platform === 'instagram' && !response) {
      const storyRef = extractStoryRef(new URL(pageUrl).pathname);
      if (storyRef) {
        // "single" grabs the viewed story; "all" grabs the whole tray.
        const ref = type === 'all' ? { ...storyRef, storyId: null } : storyRef;
        const storyItems = await resolveInstagramStories(ref);
        if (storyItems && storyItems.length) response = { urls: storyItems, platform };
      }
    }

    // Fall back to the existing single-video API + content-script path.
    if (!response) {
      // Try API-based video resolution FIRST (works without content script).
      // Skip it if the post API already ran this click — resolveViaApi would
      // only repeat the identical i.instagram.com fetch for the same shortcode.
      const apiResult = triedIgPostApi ? null : await resolveViaApi(platform, pageUrl);
      if (apiResult) {
        // API found a video — use it directly
        response = { urls: [apiResult], platform };
      } else {
        // No video via API — use content script for images
        try {
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'resolve',
            type: type,
            srcUrl: info.srcUrl || '',
            pageUrl: pageUrl,
          });
          await traceResolver({
            platform,
            path: 'dom',
            outcome: response?.urls?.length ? 'ok' : 'empty',
            itemCount: response?.urls?.length || 0,
          });
        } catch (sendErr) {
          console.warn('SocialSnag: content script unavailable:', sendErr.message);
          await traceResolver({ platform, path: 'dom', outcome: 'unavailable', detail: 'content script not loaded' });
          // Try injecting content script on demand
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [`platforms/${platform}.js`],
            });
            await new Promise((r) => setTimeout(r, 150));
            response = await chrome.tabs.sendMessage(tab.id, {
              action: 'resolve',
              type: type,
              srcUrl: info.srcUrl || '',
              pageUrl: pageUrl,
            });
            await traceResolver({
              platform,
              path: 'dom-injected',
              outcome: response?.urls?.length ? 'ok' : 'empty',
              itemCount: response?.urls?.length || 0,
            });
          } catch (injectErr) {
            await traceResolver({ platform, path: 'dom-injected', outcome: 'threw' });
            showNotification('SocialSnag: could not connect to page. Try refreshing.');
            return;
          }
        }
      }
    }

    // Feed and profile-grid carousels have no shortcode in the URL, so the
    // API-first enumeration above was skipped and the content script returned
    // only the ~2 slides Instagram lazy-renders in the DOM. If the content
    // script read the post's shortcode from its permalink, enumerate the whole
    // post via the API now and prefer that complete list; the DOM items remain
    // the fallback when the API comes up empty.
    if (platform === 'instagram' && type === 'all' && !triedIgPostApi
        && response && response.shortcode) {
      const apiItems = await resolveInstagramPost(response.shortcode);
      if (apiItems && apiItems.length) {
        response = { urls: apiItems, platform };
      }
    }

    if (!response || !response.urls || response.urls.length === 0) {
      const msg = (platform === 'instagram' && lastIgError)
        ? lastIgError
        : 'Could not find downloadable media on this element.';
      showNotification(msg);
      return;
    }

    // Copy media URL: write the resolved best URL to the clipboard instead of downloading.
    if (isCopy) {
      // Resolve a lookup placeholder (e.g. a Twitter/X timeline video identified
      // only by id) to a real URL first, the same way the download path does.
      const firstUrl = await resolveItemUrl(response.urls[0]);
      const validation = validateDownloadUrl(firstUrl);
      if (!validation.valid) {
        console.warn(`SocialSnag: refused to copy ${validation.reason}`);
        showNotification('SocialSnag: could not copy this media URL.');
        return;
      }
      const result = await copyViaOffscreen(firstUrl);
      if (result && result.ok) {
        if (platformSettings.showNotifications) showNotification('Copied media URL to clipboard.');
      } else {
        showNotification('SocialSnag: could not copy to clipboard.');
      }
      return;
    }

    // Zip: bundle multiple items into one archive when forced by the menu or by
    // the setting default. Only worth it for 2+ items.
    let zipFellBack = false;
    const shouldZip = (isZipMenu || (type === 'all' && platformSettings.zipMultiPosts))
      && response.urls.length >= 2;
    if (shouldZip) {
      const zippedCount = await downloadItemsAsZip(response.urls, response.platform);
      if (zippedCount) {
        if (platformSettings.showNotifications) {
          showNotification(`Downloaded ${zippedCount} files as a .zip from ${response.platform}.`);
        }
        return;
      }
      // Zip failed (offscreen or all fetches failed) — fall through to per-file,
      // and tell the user why they got loose files instead of the archive.
      console.warn('SocialSnag: zip failed, downloading files individually.');
      zipFellBack = true;
    }

    let count = 0;
    for (const [position, item] of response.urls.entries()) {
      const saved = await downloadMedia(item, response.platform, position + 1);
      if (saved) {
        // Record the name the file actually landed under, not the resolver's. With a
        // template configured those differ, and history is how the user finds the
        // download again -- listing a name no file has is worse than listing nothing.
        await recordDownload(
          { ...item, filename: saved.filename },
          response.platform,
          saved.downloadId,
        );
        count++;
      }
    }

    if (count > 0) {
      if (platformSettings.showNotifications) {
        const label = count === 1 ? '1 file' : `${count} files`;
        const msg = zipFellBack
          ? `Zip failed — saved ${label} individually from ${response.platform}.`
          : `Downloaded ${label} from ${response.platform}.`;
        showNotification(msg);
      }
    } else {
      // Logs what failed without logging where it lives. The whole item carries a
      // CDN url, and this is the one console line a user is most likely to be
      // reading (and pasting into a bug report) when a download breaks -- which is
      // exactly when the no-url promise has to hold. Type and filename are what
      // actually help diagnose it.
      console.warn(
        `SocialSnag: all ${response.urls.length} download attempt(s) failed for ${response.platform}`,
        response.urls.map((item) => ({ type: item.type, filename: item.filename })),
      );
      if (platformSettings.showNotifications) {
        showNotification('SocialSnag: download failed. Check the browser console for details.');
      }
    }
  } catch (error) {
    // This is the unexpected-exception path (network failure, a bug) -- distinct
    // from the "resolved but found nothing" path above, which reports its own
    // specific message. Don't mislabel a thrown error as "no media found".
    console.error('SocialSnag error:', error);
    showNotification('SocialSnag: something went wrong. Try refreshing the page.');
  }
});

// --- Background-only fallback resolver (no content script needed) ---

// Platforms this resolver has an API path for at all. Used only to tell a debug
// reader which kind of miss they are looking at.
const API_RESOLVED_PLATFORMS = new Set(['twitter', 'instagram']);

export async function resolveViaApi(platform, pageUrl) {
  // Whether the url actually carried an id this resolver understands. Without
  // this the miss below cannot tell "no id to look up" from "looked it up and
  // got nothing", and would report an image-only post as a url-parsing failure.
  let foundId = false;

  if (platform === 'twitter') {
    const match = pageUrl.match(/\/status\/(\d+)/);
    if (match) {
      foundId = true;
      const tweetId = match[1];
      const videoUrl = await resolveTwitterVideo(tweetId);
      if (videoUrl) {
        await traceResolver({ platform, path: 'api-dispatch', outcome: 'ok', itemCount: 1 });
        return { url: videoUrl, type: 'video', filename: `tweet_${tweetId}`, needsVideoLookup: false };
      }
    }
  }

  if (platform === 'instagram') {
    const match = pageUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (match) {
      foundId = true;
      const shortcode = match[2];
      const videoUrl = await resolveInstagramVideo(shortcode);
      if (videoUrl) {
        await traceResolver({ platform, path: 'api-dispatch', outcome: 'ok', itemCount: 1 });
        return { url: videoUrl, type: 'video', filename: `reel_${shortcode}`, needsVideoLookup: false };
      }
    }
  }

  // Three different misses that look identical from the outside and call for
  // three different responses: fix the url, accept that there is no video here,
  // or stop expecting an api path at all. Saying the wrong one sends the reader
  // hunting for a parsing bug that does not exist.
  let detail;
  if (!API_RESOLVED_PLATFORMS.has(platform)) detail = 'no api path for platform';
  else if (foundId) detail = 'id found, no video from api';
  else detail = 'no id in url';

  await traceResolver({ platform, path: 'api-dispatch', outcome: 'empty', detail });
  return null;
}

// --- API-based video resolvers ---

async function resolveTwitterVideo(tweetId) {
  try {
    const resp = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=0`
    );
    if (!resp.ok) {
      console.warn('SocialSnag: syndication API returned', resp.status);
      await traceResolver({ platform: 'twitter', path: 'syndication', outcome: 'http-error', status: resp.status });
      return null;
    }
    const data = await resp.json();

    // Find video media in mediaDetails
    const media = data.mediaDetails || [];
    const videoMedia = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
    if (!videoMedia?.video_info?.variants) {
      await traceResolver({
        platform: 'twitter',
        path: 'syndication',
        outcome: 'empty',
        status: resp.status,
        detail: 'no video media',
      });
      return null;
    }

    // Pick the highest bitrate MP4 variant
    const mp4s = videoMedia.video_info.variants
      .filter((v) => v.content_type === 'video/mp4' && v.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (mp4s.length > 0) {
      await traceResolver({
        platform: 'twitter',
        path: 'syndication',
        outcome: 'ok',
        status: resp.status,
        itemCount: mp4s.length,
      });
      return mp4s[0].url;
    }
    console.warn('SocialSnag: no MP4 variants in syndication response');
    await traceResolver({
      platform: 'twitter',
      path: 'syndication',
      outcome: 'empty',
      status: resp.status,
      itemCount: 0,
      detail: 'no mp4 variants',
    });
    return null;
  } catch (e) {
    console.error('SocialSnag: Twitter video API failed:', e);
    await traceResolver({ platform: 'twitter', path: 'syndication', outcome: 'threw' });
    return null;
  }
}

// Tracks the most recent Instagram API failure so the click handler can show a
// specific reason (login needed, rate limited, expired) instead of a generic message.
let lastIgError = null;

// Fetch and enumerate every media item in an Instagram post (single image/video
// or full carousel) via the private web API. Returns an array of media items, or
// null on failure — recording the reason in lastIgError for the click handler.
export async function resolveInstagramPost(shortcode) {
  try {
    const mediaId = shortcodeToMediaId(shortcode);
    if (!mediaId) return null;

    const resp = await fetch(
      `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
      {
        headers: {
          'x-ig-app-id': IG_APP_ID,
        },
        credentials: 'include',
      }
    );
    if (!resp.ok) {
      lastIgError = mapIgStatusToMessage(resp.status);
      console.warn('SocialSnag: Instagram API returned', resp.status);
      await traceResolver({ platform: 'instagram', path: 'post-api', outcome: 'http-error', status: resp.status });
      return null;
    }

    const data = await resp.json();
    const items = parsePostMedia(data, shortcode);
    if (items.length === 0) {
      lastIgError = mapIgStatusToMessage(0);
      // The case #25 was filed for: a 200 that parses to nothing looks identical to
      // a network failure from the outside.
      await traceResolver({ platform: 'instagram', path: 'post-api', outcome: 'empty', status: resp.status, itemCount: 0 });
      return null;
    }

    lastIgError = null;
    await traceResolver({ platform: 'instagram', path: 'post-api', outcome: 'ok', status: resp.status, itemCount: items.length });
    return items;
  } catch (e) {
    console.error('SocialSnag: Instagram post API failed:', e);
    await traceResolver({ platform: 'instagram', path: 'post-api', outcome: 'threw' });
    return null;
  }
}

// Look up an Instagram username's numeric user id via the private web API.
// Returns the id string, or null on failure — recording the reason in lastIgError.
async function fetchInstagramUserId(username) {
  try {
    const resp = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers: { 'x-ig-app-id': IG_APP_ID }, credentials: 'include' },
    );
    if (!resp.ok) {
      lastIgError = mapIgStatusToMessage(resp.status);
      await traceResolver({ platform: 'instagram', path: 'user-lookup', outcome: 'http-error', status: resp.status });
      return null;
    }
    const data = await resp.json();
    const userId = data?.data?.user?.id || null;
    if (!userId) await traceResolver({ platform: 'instagram', path: 'user-lookup', outcome: 'empty', status: resp.status });
    return userId;
  } catch (e) {
    console.error('SocialSnag: IG user lookup failed:', e);
    await traceResolver({ platform: 'instagram', path: 'user-lookup', outcome: 'threw' });
    return null;
  }
}

// Resolve a story ref to its media via the reels_media API. storyId null means
// the whole active tray. Returns an array of media items, or null on failure —
// recording the reason in lastIgError for the click handler.
export async function resolveInstagramStories({ username, storyId }) {
  const userId = await fetchInstagramUserId(username);
  if (!userId) return null;
  try {
    const resp = await fetch(
      `https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`,
      { headers: { 'x-ig-app-id': IG_APP_ID }, credentials: 'include' },
    );
    if (!resp.ok) {
      lastIgError = mapIgStatusToMessage(resp.status);
      await traceResolver({ platform: 'instagram', path: 'story-api', outcome: 'http-error', status: resp.status });
      return null;
    }
    const data = await resp.json();
    const items = parseStoryTray(data, { storyId });
    if (items.length === 0) {
      lastIgError = mapIgStatusToMessage(0);
      // Expected when a story has aged out of the 24h window, and indistinguishable
      // from a lookup bug without this line.
      await traceResolver({ platform: 'instagram', path: 'story-api', outcome: 'empty', status: resp.status, itemCount: 0, detail: storyId ? 'single story' : 'full tray' });
      return null;
    }
    lastIgError = null;
    await traceResolver({ platform: 'instagram', path: 'story-api', outcome: 'ok', status: resp.status, itemCount: items.length });
    return items;
  } catch (e) {
    console.error('SocialSnag: IG stories API failed:', e);
    await traceResolver({ platform: 'instagram', path: 'story-api', outcome: 'threw' });
    return null;
  }
}

// Resolve the first video URL in an Instagram post (used by single-video flows).
async function resolveInstagramVideo(shortcode) {
  const items = await resolveInstagramPost(shortcode);
  if (!items) return null;
  const video = items.find((it) => it.type === 'video');
  return video ? video.url : null;
}

// Bundle multiple resolved media items into one .zip via the offscreen document.
// Returns the count of files archived (a truthy number) once the download has
// started, or false to fall back to per-file.
export async function downloadItemsAsZip(items, platform) {
  // Zip bundles direct URLs only. If any item needs a video-API lookup (the
  // Instagram DOM fallback emits video slides with no url yet), fall back to
  // per-file so a slide is never silently dropped from the archive.
  if (items.some((it) => it.needsVideoLookup)) return false;

  const { downloadPath, filenameTemplate } = await chrome.storage.sync.get({
    downloadPath: 'SocialSnag/{platform}',
    filenameTemplate: '',
  });

  const files = [];
  const seen = new Set();
  for (const item of items) {
    const validation = validateDownloadUrl(item.url);
    if (!validation.valid) {
      console.warn(`SocialSnag: skipping ${validation.reason} in zip`);
      continue;
    }
    const ext = guessExtension(item.url, item.type);
    const base = sanitizeFilename(
      resolveBaseFilename(item, platform, filenameTemplate, files.length + 1),
    );
    // Sanitize the whole entry name: guessExtension can echo a ?format= value
    // containing / or .., and client-zip writes entry names verbatim.
    let name = sanitizeFilename(`${base}${ext}`);
    let n = 2;
    while (seen.has(name)) { name = sanitizeFilename(`${base}_${n}${ext}`); n++; }
    seen.add(name);
    files.push({ name, url: item.url });
  }
  if (files.length === 0) return false;

  const zip = await zipViaOffscreen(files);
  if (!zip) return false;

  const stamp = Date.now();
  const zipBase = `${platform}_${stamp}`;
  const zipPath = sanitizeDownloadPath(zipBase, platform, '.zip', downloadPath);
  let downloadId = null;
  try {
    downloadId = await chrome.downloads.download({
      url: zip.url,
      filename: zipPath,
      conflictAction: 'uniquify',
    });
  } catch (e) {
    console.error('SocialSnag: zip download failed:', e);
    await revokeViaOffscreen(zip.url); // never started; safe to revoke now
    return false;
  }

  // Revoke only after the download finishes reading the blob (see below).
  await trackBlobForDownload(downloadId, zip.url);

  // Record one history entry for the archive; no url is stored.
  await recordDownload({ type: 'zip', filename: `${zipBase}.zip` }, platform, downloadId);
  return zip.count ?? files.length;
}

// Blob URLs whose download has not finished reading them yet, as
// { [downloadId]: blobUrl }. Revoking earlier truncates the file, because
// chrome.downloads.download resolves when the download STARTS, not when it
// finishes reading the blob.
//
// This lives in session storage rather than a module variable, and the listener
// below is registered at top level rather than per-download, because an MV3
// service worker can be torn down while a large zip is still downloading. The
// download itself survives (the blob belongs to the offscreen document, which
// outlives the worker), so a per-download listener would die with the worker and
// leave the blob to accumulate in an offscreen document that is never closed.
const PENDING_BLOBS_KEY = 'pendingBlobRevokes';

// Read-modify-write of the map above, serialized. Two zip downloads started
// close together would otherwise both read the same object and each write back
// its own copy, and the later write would drop the earlier download's entry --
// leaking exactly the blob this map exists to revoke.
let pendingBlobWrites = Promise.resolve();

function updatePendingBlobs(mutate) {
  const next = pendingBlobWrites.then(async () => {
    const { [PENDING_BLOBS_KEY]: stored } = await chrome.storage.session.get(PENDING_BLOBS_KEY);
    const pending = stored || {};
    const result = mutate(pending);
    await chrome.storage.session.set({ [PENDING_BLOBS_KEY]: pending });
    return result;
  });
  // Keep the chain alive even if one update throws, or every later write stalls.
  pendingBlobWrites = next.catch(() => {});
  return next;
}

async function trackBlobForDownload(downloadId, blobUrl) {
  await updatePendingBlobs((pending) => {
    pending[downloadId] = blobUrl;
  });
  // A short download can reach its terminal state before the write above lands,
  // and the listener would have found nothing to revoke. Catch that up here.
  const item = await findDownload(downloadId);
  if (isTerminalDownload(item)) {
    await revokePendingBlob(downloadId);
  }
}

async function revokePendingBlob(downloadId) {
  // Claim the entry inside the serialized update so a duplicate event cannot
  // revoke the same URL twice.
  const blobUrl = await updatePendingBlobs((pending) => {
    const url = pending[downloadId];
    delete pending[downloadId];
    return url;
  });
  if (!blobUrl) return;
  await revokeViaOffscreen(blobUrl);
}

async function findDownload(downloadId) {
  try {
    const [item] = await chrome.downloads.search({ id: downloadId });
    return item || null;
  } catch (e) {
    console.warn('SocialSnag: could not query download state:', e);
    return undefined;
  }
}

function isTerminalDownload(item) {
  return item === null
    || item?.state === 'complete'
    || (item?.state === 'interrupted' && !item.canResume);
}

async function revokeBlobIfTerminal(downloadId) {
  const item = await findDownload(downloadId);
  if (isTerminalDownload(item)) await revokePendingBlob(downloadId);
}

chrome.downloads.onChanged.addListener(async (delta) => {
  const state = delta.state?.current;
  if (state === 'complete') {
    await revokePendingBlob(delta.id);
    return;
  }
  const stoppedBeingResumable = delta.canResume && delta.canResume.current !== true;
  if (state !== 'interrupted' && !stoppedBeingResumable) return;
  // An interrupted download may still be resumable, and resuming reads the blob
  // again -- revoking here would make the resume fail with the source gone. Only
  // an interruption it cannot come back from is really terminal. If the download
  // cannot be found at all, its record is gone and no resume is possible. Query
  // failures stay distinct from a missing record so transient errors keep the blob.
  await revokeBlobIfTerminal(delta.id);
});

chrome.downloads.onErased.addListener(async (downloadId) => {
  await revokePendingBlob(downloadId);
});

// Validate and download a single media item
// Resolve a lookup-placeholder item — a Twitter/X or Instagram video the content
// script could only identify by id, needing a background API call — to a concrete
// URL. Items that already carry a url pass straight through. Returns null if a
// placeholder cannot be resolved. Shared by the download and copy-URL paths so
// both handle these items identically.
export async function resolveItemUrl(item) {
  if (!item.needsVideoLookup) return item.url;
  if (item.tweetId) return resolveTwitterVideo(item.tweetId);
  if (item.shortcode) return resolveInstagramVideo(item.shortcode);
  return null;
}

// How long to wait for Chrome to report the name it chose. Assignment is normally
// immediate, so this is the ceiling on a download that errors before ever being
// named, not a typical wait -- nothing is named after that and no delta is coming.
const FILENAME_ASSIGN_TIMEOUT_MS = 2000;

// Resolves with the filename Chrome assigns to this download, or null if none
// arrives before the timeout. Returns a cancel alongside it: the caller has to call
// it on every exit, or the listener and its timer outlive the download.
function awaitFilenameDelta(downloadId, timeoutMs) {
  let cancel;
  const promise = new Promise((resolve) => {
    const finish = (value) => { cancel(); resolve(value); };
    const listener = (delta) => {
      if (delta.id === downloadId && delta.filename?.current) finish(delta.filename.current);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    cancel = () => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
    };
    chrome.downloads.onChanged.addListener(listener);
  });
  return { promise, cancel };
}

// The basename Chrome actually wrote, which is not always the one it was handed:
// conflictAction:'uniquify' is applied after download() takes the path, so a second
// `facebook.jpg` lands as `facebook (1).jpg` and the requested path never learns it.
// Asking the download item is the only way to see that counter.
//
// Chrome names the file asynchronously, so the lookup can land in the window before
// it has one -- and that window is likeliest on exactly the downloads this function
// exists for. A template without {index} renders the same path for every item in an
// album, so a ten-photo post fires ten collisions at once, which is both the case
// where the requested name is wrong and the case where the queue is deepest. Waiting
// for the name is therefore the whole point rather than a refinement of it.
//
// Only a download that fails before being named leaves nothing to wait for. Then the
// requested basename is the closest thing available: it differs from the real one
// only where Chrome changed it, and Chrome never got that far.
async function savedBasename(downloadId, requestedPath) {
  // Only folder separators survive sanitizing in a path, so the last one ends the
  // folder. A DownloadItem filename is an absolute local path from the OS, so it can
  // carry either separator regardless of what we asked for.
  const fallback = requestedPath.slice(requestedPath.lastIndexOf('/') + 1);
  // Listen before looking. Chrome can assign the name in the gap between a search
  // that comes back empty and a listener attaching, and onChanged does not replay
  // what it already fired -- so searching first would drop exactly the delta we are
  // waiting for and sit here until the timeout.
  const waiter = awaitFilenameDelta(downloadId, FILENAME_ASSIGN_TIMEOUT_MS);
  try {
    const [saved] = await chrome.downloads.search({ id: downloadId });
    // Wait only on positive evidence that a name is still coming. An item Chrome has
    // already finished with, or one it does not know about, will never fire a filename
    // delta, and the album loop downloads sequentially -- so blocking on a name that
    // is not coming stalls every item behind it for the full timeout.
    const stillNaming = saved?.state === 'in_progress';
    const p = saved?.filename || (stillNaming ? await waiter.promise : null);
    if (!p) return fallback;
    return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  } catch (e) {
    console.debug('SocialSnag: could not read the saved filename; using the requested one', e);
    return fallback;
  } finally {
    waiter.cancel();
  }
}

// `index` is this item's position in the batch the user asked for, counting from 1.
// downloadMedia runs in a loop over an album, so defaulting it to 1 would name every
// file in a ten-photo post identically and leave conflictAction:'uniquify' to tell
// them apart -- which is how a duplicate gets to look like a numbered set.
//
// Returns {downloadId, filename} on success and null on every failure, where
// `filename` is the basename on disk. The caller needs it for history and has no way
// to work it out: the template, the folder setting, and the sanitizer all live in
// here, so a second derivation out there would be a second answer.
async function downloadMedia(item, platform, index = 1) {
  // Resolve API-based video lookups to a concrete URL before downloading.
  if (item.needsVideoLookup) {
    const resolvedUrl = await resolveItemUrl(item);
    if (!resolvedUrl) {
      console.warn('SocialSnag: video API lookup returned no URL');
      return null;
    }
    item = { ...item, url: resolvedUrl, needsVideoLookup: false };
  }

  const validation = validateDownloadUrl(item.url);
  if (!validation.valid) {
    console.warn(`SocialSnag: rejected ${validation.reason}`);
    return null;
  }

  const { downloadPath, filenameTemplate } = await chrome.storage.sync.get({
    downloadPath: 'SocialSnag/{platform}',
    filenameTemplate: '',
  });
  const ext = guessExtension(item.url, item.type);
  // resolveBaseFilename always returns something: it falls back to the resolver's
  // name, then to platform and index.
  const rawFilename = resolveBaseFilename(item, platform, filenameTemplate, index);
  const path = sanitizeDownloadPath(rawFilename, platform, ext, downloadPath);

  const downloadUrl = item.url;

  try {
    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: path,
      conflictAction: 'uniquify',
    });
    return { downloadId, filename: await savedBasename(downloadId, path) };
  } catch (e) {
    console.error('SocialSnag: download failed:', e);
    return null;
  }
}

// Record a successful download to history
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

  // Prune to 50 entries max
  if (downloadHistory.length > 50) {
    downloadHistory.splice(0, downloadHistory.length - 50);
  }

  await chrome.storage.local.set({ downloadHistory });
}

// Show a browser notification
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialSnag',
    message: message,
  });
}

// Clean up captured media when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `captured_${tabId}`;
  await chrome.storage.session.remove(key);
});

// Respond to content script requests for captured media
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
