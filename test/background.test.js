import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectPlatform,
  guessExtension,
  validateDownloadUrl,
  sanitizeDownloadPath,
  resolveBaseFilename,
  formatLocalDate,
  resolveInstagramPost,
  resolveInstagramStories,
  downloadItemsAsZip,
  resolveItemUrl,
  resolveViaApi,
  parseSubmittedPageUrl,
  orchestrateSubmittedDownload,
} from '../src/background.js';
import { mapIgStatusToMessage } from '../src/platforms/instagram-api.js';

describe('detectPlatform', () => {
  it('detects instagram', () => {
    expect(detectPlatform('https://www.instagram.com/p/ABC123/')).toBe('instagram');
  });

  it('detects twitter', () => {
    expect(detectPlatform('https://twitter.com/user/status/123')).toBe('twitter');
  });

  it('detects x.com as twitter', () => {
    expect(detectPlatform('https://x.com/user/status/123')).toBe('twitter');
  });

  it('detects facebook', () => {
    expect(detectPlatform('https://www.facebook.com/photo/123')).toBe('facebook');
  });

  it('returns null for unsupported sites', () => {
    expect(detectPlatform('https://www.reddit.com/r/pics')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(detectPlatform(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectPlatform('')).toBeNull();
  });
});

describe('guessExtension', () => {
  it('returns .mp4 for video type', () => {
    expect(guessExtension('https://example.com/file', 'video')).toBe('.mp4');
  });

  it('uses format search param when present', () => {
    expect(guessExtension('https://example.com/file?format=webp', 'image')).toBe('.webp');
  });

  it('extracts extension from path (.jpg)', () => {
    expect(guessExtension('https://pbs.twimg.com/media/photo.jpg', 'image')).toBe('.jpg');
  });

  it('extracts extension from path (.png with query string)', () => {
    expect(guessExtension('https://example.com/image.png?w=800', 'image')).toBe('.png');
  });

  it('falls back to .jpg when no extension or format found', () => {
    expect(guessExtension('https://example.com/image', 'image')).toBe('.jpg');
  });

  it('falls back to .jpg for malformed URL', () => {
    expect(guessExtension('not a url', 'image')).toBe('.jpg');
  });
});

describe('validateDownloadUrl', () => {
  it('accepts valid HTTPS CDN URL', () => {
    const result = validateDownloadUrl('https://scontent.cdninstagram.com/image.jpg');
    expect(result.valid).toBe(true);
  });

  it('rejects HTTP URL', () => {
    const result = validateDownloadUrl('http://scontent.cdninstagram.com/image.jpg');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('non-HTTPS URL');
  });

  it('rejects untrusted domain', () => {
    const result = validateDownloadUrl('https://evil.com/image.jpg');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('untrusted domain');
  });

  it('rejects dot-boundary bypass (evilcdninstagram.com)', () => {
    const result = validateDownloadUrl('https://evilcdninstagram.com/image.jpg');
    expect(result.valid).toBe(false);
  });

  it('rejects malformed URL', () => {
    const result = validateDownloadUrl('not a url');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid URL');
  });

  it('rejects empty/null URL', () => {
    const result = validateDownloadUrl('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('empty URL');
  });

  it('accepts pbs.twimg.com', () => {
    const result = validateDownloadUrl('https://pbs.twimg.com/media/photo.jpg');
    expect(result.valid).toBe(true);
  });

  it('accepts fbcdn.net subdomain', () => {
    const result = validateDownloadUrl('https://scontent-lax3-1.xx.fbcdn.net/image.jpg');
    expect(result.valid).toBe(true);
  });
});

describe('parseSubmittedPageUrl', () => {
  it.each([
    ['https://www.instagram.com/p/ABC_123/?igsh=share#comments', 'instagram', 'https://www.instagram.com/p/ABC_123/?igsh=share'],
    ['https://instagram.com/reel/C9-ab_1/', 'instagram', 'https://instagram.com/reel/C9-ab_1/'],
    ['https://www.instagram.com/tv/IGTV123/', 'instagram', 'https://www.instagram.com/tv/IGTV123/'],
    ['https://www.instagram.com/stories/natgeo/1234567890/', 'instagram', 'https://www.instagram.com/stories/natgeo/1234567890/'],
    ['https://twitter.com/jack/status/20', 'twitter', 'https://twitter.com/jack/status/20'],
    ['https://x.com/example_user/status/1234567890123456789?s=20', 'twitter', 'https://x.com/example_user/status/1234567890123456789?s=20'],
    ['https://X.COM/example_user/status/123#section', 'twitter', 'https://X.COM/example_user/status/123'],
    ['https://x.com/i/web/status/1234567890123456789?s=20', 'twitter', 'https://x.com/i/web/status/1234567890123456789?s=20'],
    ['https://twitter.com/i/web/status/20', 'twitter', 'https://twitter.com/i/web/status/20'],
    ['https://www.facebook.com/example/posts/1234567890/', 'facebook', 'https://www.facebook.com/example/posts/1234567890/'],
    ['https://www.facebook.com/example/posts/pfbid02AbCdEf/', 'facebook', 'https://www.facebook.com/example/posts/pfbid02AbCdEf/'],
    ['https://www.facebook.com/groups/example/posts/1234567890/', 'facebook', 'https://www.facebook.com/groups/example/posts/1234567890/'],
    ['https://www.facebook.com/groups/123/permalink/4567890123/', 'facebook', 'https://www.facebook.com/groups/123/permalink/4567890123/'],
    ['https://www.facebook.com/permalink.php?story_fbid=1234567890&id=42', 'facebook', 'https://www.facebook.com/permalink.php?story_fbid=1234567890&id=42'],
    ['https://www.facebook.com/story.php?story_fbid=pfbid02AbCdEf&id=42', 'facebook', 'https://www.facebook.com/story.php?story_fbid=pfbid02AbCdEf&id=42'],
    ['https://www.facebook.com/photo.php?fbid=1234567890&id=42', 'facebook', 'https://www.facebook.com/photo.php?fbid=1234567890&id=42'],
    ['https://www.facebook.com/photo/?fbid=1234567890', 'facebook', 'https://www.facebook.com/photo/?fbid=1234567890'],
    ['https://www.facebook.com/example/photos/a.123/4567890123/', 'facebook', 'https://www.facebook.com/example/photos/a.123/4567890123/'],
    ['https://www.facebook.com/example/videos/1234567890/', 'facebook', 'https://www.facebook.com/example/videos/1234567890/'],
    ['https://www.facebook.com/reel/1234567890/', 'facebook', 'https://www.facebook.com/reel/1234567890/'],
    ['https://www.facebook.com/watch/?v=1234567890', 'facebook', 'https://www.facebook.com/watch/?v=1234567890'],
    ['https://www.facebook.com/share/p/AbC_def-123/', 'facebook', 'https://www.facebook.com/share/p/AbC_def-123/'],
    ['https://www.facebook.com/share/r/AbC_def-123/', 'facebook', 'https://www.facebook.com/share/r/AbC_def-123/'],
    ['https://www.facebook.com/share/v/AbC_def-123/', 'facebook', 'https://www.facebook.com/share/v/AbC_def-123/'],
    ['https://bsky.app/profile/alice.bsky.social/post/3labc123xyz', 'bluesky', 'https://bsky.app/profile/alice.bsky.social/post/3labc123xyz'],
    ['https://bsky.app/profile/did:plc:abc123/post/3lxyz789', 'bluesky', 'https://bsky.app/profile/did:plc:abc123/post/3lxyz789'],
  ])('accepts an exact post URL: %s', (raw, platform, normalized) => {
    expect(parseSubmittedPageUrl(raw)).toEqual({ url: normalized, platform });
  });

  it.each([
    ['', 'invalid_url'],
    [null, 'invalid_url'],
    ['not a url', 'invalid_url'],
    ['http://x.com/user/status/123', 'invalid_url'],
    ['ftp://www.instagram.com/p/ABC/', 'invalid_url'],
    ['https://user:secret@x.com/user/status/123', 'invalid_url'],
    ['https://x.com:8443/user/status/123', 'invalid_url'],
    [`https://x.com/user/status/${'1'.repeat(2100)}`, 'invalid_url'],
    ['https://www.instagram.com/stories/highlights/123/', 'invalid_url'],
    ['https://www.instagram.com/accounts/login/', 'invalid_url'],
    ['https://www.instagram.com/example/', 'invalid_url'],
    ['https://x.com/settings/account', 'invalid_url'],
    ['https://x.com/user/status/not-a-number', 'invalid_url'],
    ['https://x.com/user/status/123/photo/1', 'invalid_url'],
    ['https://x.com/i/web/status/not-a-number', 'invalid_url'],
    ['https://x.com/i/web/status/123/photo/1', 'invalid_url'],
    ['https://x.com/i/web/status/', 'invalid_url'],
    ['https://www.facebook.com/login/', 'invalid_url'],
    ['https://www.facebook.com/settings/', 'invalid_url'],
    ['https://www.facebook.com/settings/posts/123', 'invalid_url'],
    ['https://www.facebook.com/login/posts/123', 'invalid_url'],
    ['https://www.facebook.com/!!!/posts/123/', 'invalid_url'],
    ['https://www.facebook.com/example/photos/not-a-facebook-photo-route/123/', 'invalid_url'],
    ['https://www.facebook.com/example/', 'invalid_url'],
    ['https://www.facebook.com/watch/', 'invalid_url'],
    ['https://bsky.app/profile/alice.bsky.social', 'invalid_url'],
    ['https://bsky.app/settings', 'invalid_url'],
    ['https://bsky.app/profile/::::/post/abc', 'invalid_url'],
    ['https://staging.bsky.app/profile/alice.bsky.social/post/3labc123xyz', 'unsupported_url'],
    [' https://x.com/user/status/123', 'invalid_url'],
    ['https://x.com/user/status/123 ', 'invalid_url'],
    ['https://evilinstagram.com/p/ABC/', 'unsupported_url'],
    ['https://instagram.com.evil.example/p/ABC/', 'unsupported_url'],
    ['https://notx.com/user/status/123', 'unsupported_url'],
    ['https://x.com.evil.example/user/status/123', 'unsupported_url'],
    ['https://evilfacebook.com/example/posts/123', 'unsupported_url'],
    ['https://bsky.app.evil.example/profile/a/post/3abc', 'unsupported_url'],
    ['https://example.com/x.com/user/status/123', 'unsupported_url'],
  ])('rejects unsafe or non-post input: %s', (raw, code) => {
    expect(parseSubmittedPageUrl(raw)).toEqual({ error: code });
  });
});

describe('sanitizeDownloadPath', () => {
  it('assembles correct path with platform folder', () => {
    const path = sanitizeDownloadPath('photo_123', 'instagram', '.jpg');
    expect(path).toBe('SocialSnag/instagram/photo_123.jpg');
  });

  it('strips path traversal from filename', () => {
    const path = sanitizeDownloadPath('../../../etc/passwd', 'twitter', '.jpg');
    // ../ is stripped, then / becomes _
    expect(path).toBe('SocialSnag/twitter/etc_passwd.jpg');
    expect(path).not.toContain('..');
  });

  it('uses timestamp-like filename when null is not given', () => {
    // The caller passes Date.now() as fallback, but sanitizeDownloadPath
    // itself just sanitizes whatever is passed
    const path = sanitizeDownloadPath('1679012345678', 'facebook', '.png');
    expect(path).toBe('SocialSnag/facebook/1679012345678.png');
  });

  it('replaces special characters in filename', () => {
    const path = sanitizeDownloadPath('file<>name', 'instagram', '.jpg');
    expect(path).toBe('SocialSnag/instagram/file__name.jpg');
  });
});

// Fetch-shaped Instagram post nodes (media_type mirrors the private web API).
const igImgSlide = (u) => ({ media_type: 1, image_versions2: { candidates: [{ url: u, width: 1080, height: 1080 }] } });
const igVidSlide = (u) => ({ media_type: 2, video_versions: [{ url: u, width: 1080 }] });

describe('resolveInstagramPost', () => {
  afterEach(() => resetFetch());

  it('enumerates every item in a carousel post', async () => {
    installFetch((url) => {
      if (!url.includes('i.instagram.com')) return null;
      return {
        status: 200,
        json: { items: [{ carousel_media: [
          igImgSlide('https://cdn.cdninstagram.com/1.jpg'),
          igVidSlide('https://cdn.cdninstagram.com/2.mp4'),
          igImgSlide('https://cdn.cdninstagram.com/3.jpg'),
        ] }] },
      };
    });

    const { items } = await resolveInstagramPost('ABC');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.url)).toEqual([
      'https://cdn.cdninstagram.com/1.jpg',
      'https://cdn.cdninstagram.com/2.mp4',
      'https://cdn.cdninstagram.com/3.jpg',
    ]);
    expect(items.map((i) => i.type)).toEqual(['image', 'video', 'image']);
    expect(items.map((i) => i.filename)).toEqual(['post_ABC_1', 'post_ABC_2', 'post_ABC_3']);
  });

  it('reports the rate-limit reason instead of items when the API 429s', async () => {
    installFetch(() => ({ status: 429, json: {} }));
    const result = await resolveInstagramPost('ABC');
    expect(result.items).toBeUndefined();
    // The reason rides the return value, so a concurrent click cannot claim it (#30).
    expect(result.error).toBe(mapIgStatusToMessage(429));
    expect(result.code).toBe('rate_limited');
  });

  it('gives each concurrent lookup its own failure reason (#30)', async () => {
    // The race the module-level lastIgError lost: two clicks in different tabs
    // fail for different reasons at once. Both resolvers wrote the one shared
    // slot, so whichever finished last decided what BOTH notifications said.
    // Reasons now ride the return values, so neither call can claim the other's.
    const statuses = [401, 429];
    let call = 0;
    installFetch(() => ({ status: statuses[call++], json: {} }));

    const [first, second] = await Promise.all([
      resolveInstagramPost('AAA'),
      resolveInstagramPost('BBB'),
    ]);

    expect(first.error).toBe(mapIgStatusToMessage(401));
    expect(second.error).toBe(mapIgStatusToMessage(429));
    // Guards the assertion above: if the two statuses ever mapped to the same
    // copy, the test would pass while proving nothing about attribution.
    expect(first.error).not.toBe(second.error);
  });
});

// Fetch-shaped Instagram story item (media_type mirrors the private web API).
const igStoryImg = (pk, u) => ({ pk, image_versions2: { candidates: [{ url: u, width: 1080, height: 1920 }] } });

describe('resolveInstagramStories', () => {
  afterEach(() => resetFetch());

  it('derives user id then returns the active tray', async () => {
    installFetch((url) => {
      if (url.includes('web_profile_info')) return { status: 200, json: { data: { user: { id: '55' } } } };
      if (url.includes('reels_media')) {
        return { status: 200, json: { reels_media: [{ items: [igStoryImg('1', 'https://cdn.cdninstagram.com/s.jpg')] }] } };
      }
      return null;
    });

    const { items } = await resolveInstagramStories({ username: 'x', storyId: null });
    expect(items.map((i) => i.url)).toEqual(['https://cdn.cdninstagram.com/s.jpg']);
  });

  it('returns only the viewed story when storyId matches', async () => {
    installFetch((url) => {
      if (url.includes('web_profile_info')) return { status: 200, json: { data: { user: { id: '55' } } } };
      if (url.includes('reels_media')) {
        return { status: 200, json: { reels_media: [{ items: [
          igStoryImg('1', 'https://cdn.cdninstagram.com/1.jpg'),
          igStoryImg('2', 'https://cdn.cdninstagram.com/2.jpg'),
        ] }] } };
      }
      return null;
    });

    const { items } = await resolveInstagramStories({ username: 'x', storyId: '2' });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://cdn.cdninstagram.com/2.jpg');
  });

  it('returns a stable auth code when the account lookup requires login', async () => {
    installFetch((url) => url.includes('web_profile_info')
      ? { status: 401, json: {} }
      : null);

    const result = await resolveInstagramStories({ username: 'private', storyId: null });

    expect(result.error).toBe(mapIgStatusToMessage(401));
    expect(result.code).toBe('auth_required');
  });

  it('returns a stable no-media code for an empty active tray', async () => {
    installFetch((url) => {
      if (url.includes('web_profile_info')) return { status: 200, json: { data: { user: { id: '55' } } } };
      if (url.includes('reels_media')) return { status: 200, json: { reels_media: [{ items: [] }] } };
      return null;
    });

    const result = await resolveInstagramStories({ username: 'x', storyId: null });

    expect(result.error).toBe(mapIgStatusToMessage(0));
    expect(result.code).toBe('no_media');
  });
});

describe('context menu click — Instagram total failure', () => {
  afterEach(() => resetFetch());

  it('shows the login message when the API 401s and the DOM finds nothing', async () => {
    // API rejects with 401 (not logged in); the default tabs.sendMessage mock
    // returns {} (no media), so both resolution paths come up empty.
    installFetch((url) => (url.includes('i.instagram.com') ? { status: 401, json: {} } : null));

    const notes = [];
    const origCreate = globalThis.chrome.notifications.create;
    globalThis.chrome.notifications.create = (opts) => { notes.push(opts.message); };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(
        { menuItemId: 'socialsnag-download-all', pageUrl: 'https://www.instagram.com/p/ABC/', srcUrl: '' },
        { id: 1, url: 'https://www.instagram.com/p/ABC/' }
      );
    } finally {
      globalThis.chrome.notifications.create = origCreate;
    }

    expect(notes).toContain('Log in to Instagram to download this.');
  });

  it('tells two concurrent clicks apart when they fail differently (#30)', async () => {
    // The reported bug, at the surface that had it. Two tabs fail at once for
    // different reasons; the handler used to read the reason out of one shared
    // module variable, so the resolver that finished last decided what BOTH
    // notifications said and one tab got the other tab's message.
    const statuses = [401, 429];
    let call = 0;
    installFetch((url) => (url.includes('i.instagram.com')
      ? { status: statuses[call++] ?? 429, json: {} }
      : null));

    const notes = [];
    const origCreate = globalThis.chrome.notifications.create;
    globalThis.chrome.notifications.create = (opts) => { notes.push(opts.message); };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await Promise.all([
        handler(
          { menuItemId: 'socialsnag-download-all', pageUrl: 'https://www.instagram.com/p/AAA/', srcUrl: '' },
          { id: 1, url: 'https://www.instagram.com/p/AAA/' }
        ),
        handler(
          { menuItemId: 'socialsnag-download-all', pageUrl: 'https://www.instagram.com/p/BBB/', srcUrl: '' },
          { id: 2, url: 'https://www.instagram.com/p/BBB/' }
        ),
      ]);
    } finally {
      globalThis.chrome.notifications.create = origCreate;
    }

    // Asserted as a set, not per-click: which tab draws which status depends on
    // fetch ordering, and the bug is that both notifications collapse onto one
    // message. Pre-fix, both of these read the rate-limit copy.
    expect(notes).toContain(mapIgStatusToMessage(401));
    expect(notes).toContain(mapIgStatusToMessage(429));
  });
});

describe('resolveItemUrl', () => {
  afterEach(() => resetFetch());

  it('passes through an item that already has a url', async () => {
    expect(await resolveItemUrl({ url: 'https://cdn.example/a.jpg' })).toBe('https://cdn.example/a.jpg');
  });

  it('resolves a Twitter lookup placeholder via the syndication API', async () => {
    installFetch((url) => {
      if (!url.includes('syndication.twimg.com')) return null;
      return { status: 200, json: { mediaDetails: [{ type: 'video', video_info: { variants: [
        { content_type: 'video/mp4', url: 'https://video.twimg.com/lo.mp4', bitrate: 256000 },
        { content_type: 'video/mp4', url: 'https://video.twimg.com/hi.mp4', bitrate: 832000 },
      ] } }] } };
    });
    // A copy or download of this placeholder must resolve to the real MP4, not undefined.
    const url = await resolveItemUrl({ needsVideoLookup: true, tweetId: '123', type: 'video' });
    expect(url).toBe('https://video.twimg.com/hi.mp4');
  });

  it('returns null for a placeholder with no id to resolve', async () => {
    expect(await resolveItemUrl({ needsVideoLookup: true })).toBeNull();
  });
});

describe('copy media URL', () => {
  afterEach(() => resetFetch());

  // Bluesky avoids IG API fetch mocking: resolveViaApi has no bluesky branch, so
  // resolution falls to the content-script path (chrome.tabs.sendMessage), and
  // cdn.bsky.app is on the download allowlist.
  const copyInfo = {
    menuItemId: 'socialsnag-copy-url',
    srcUrl: 'https://cdn.bsky.app/img/a.jpg',
    pageUrl: 'https://bsky.app/profile/x/post/1',
  };
  const copyTab = { id: 5, url: 'https://bsky.app/profile/x/post/1' };

  it('copies the resolved URL to the clipboard and does not download', async () => {
    // Offscreen document already exists, so ensureOffscreen is a no-op.
    const origGetContexts = globalThis.chrome.runtime.getContexts;
    globalThis.chrome.runtime.getContexts = async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }];

    // Capture the messages copyViaOffscreen sends to the offscreen document.
    const sent = [];
    const origSendMessage = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = async (msg) => { sent.push(msg); return { ok: true }; };

    // Content script resolves a single allowlisted Bluesky image.
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({
      urls: [{ url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'bsky_a' }],
      platform: 'bluesky',
    });

    const downloaded = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloaded.push(opts.url); return downloaded.length; };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(copyInfo, copyTab);
    } finally {
      globalThis.chrome.runtime.getContexts = origGetContexts;
      globalThis.chrome.runtime.sendMessage = origSendMessage;
      globalThis.chrome.tabs.sendMessage = origTabsSend;
      globalThis.chrome.downloads.download = origDownload;
    }

    expect(sent).toContainEqual({
      target: 'offscreen',
      action: 'clipboard',
      text: 'https://cdn.bsky.app/img/a.jpg',
    });
    expect(downloaded).toEqual([]);
  });

  it('aborts the copy and does not resolve when clipboard permission is denied', async () => {
    // clipboardWrite is optional; if the user declines the request, copy stops
    // before touching the offscreen document or the content script.
    const origRequest = globalThis.chrome.permissions.request;
    globalThis.chrome.permissions.request = async () => false;

    const sent = [];
    const origSendMessage = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = async (msg) => { sent.push(msg); return { ok: true }; };

    let tabsAsked = false;
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => { tabsAsked = true; return { urls: [], platform: 'bluesky' }; };

    const notes = [];
    const origNotify = globalThis.chrome.notifications.create;
    globalThis.chrome.notifications.create = (opts) => { notes.push(opts); };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(copyInfo, copyTab);
    } finally {
      globalThis.chrome.permissions.request = origRequest;
      globalThis.chrome.runtime.sendMessage = origSendMessage;
      globalThis.chrome.tabs.sendMessage = origTabsSend;
      globalThis.chrome.notifications.create = origNotify;
    }

    // No clipboard message, no resolution attempt, and a permission-specific note.
    expect(sent).toEqual([]);
    expect(tabsAsked).toBe(false);
    expect(notes.some((n) => /permission/i.test(n.message))).toBe(true);
  });

  it('shows a not-found notification and does not copy when nothing resolves', async () => {
    const origGetContexts = globalThis.chrome.runtime.getContexts;
    globalThis.chrome.runtime.getContexts = async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }];

    const sent = [];
    const origSendMessage = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = async (msg) => { sent.push(msg); return { ok: true }; };

    // Content script resolves nothing.
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({ urls: [], platform: 'bluesky' });

    const notes = [];
    const origCreate = globalThis.chrome.notifications.create;
    globalThis.chrome.notifications.create = (opts) => { notes.push(opts.message); };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(copyInfo, copyTab);
    } finally {
      globalThis.chrome.runtime.getContexts = origGetContexts;
      globalThis.chrome.runtime.sendMessage = origSendMessage;
      globalThis.chrome.tabs.sendMessage = origTabsSend;
      globalThis.chrome.notifications.create = origCreate;
    }

    // Copy was never attempted: no clipboard message reached the offscreen target.
    expect(sent.some((m) => m && m.action === 'clipboard')).toBe(false);
    expect(notes).toContain('Could not find downloadable media on this element.');
  });
});

describe('context menu click — Instagram DOM fallback', () => {
  afterEach(() => resetFetch());

  it('downloads content-script media when the post API fails but the DOM has media', async () => {
    // Post API 404s (resolveInstagramPost returns null); the content script
    // still resolves real CDN images, which must still get downloaded.
    installFetch((url) => (url.includes('i.instagram.com') ? { status: 404, json: {} } : null));

    const domUrls = [
      'https://scontent.cdninstagram.com/a.jpg',
      'https://scontent.cdninstagram.com/b.jpg',
    ];
    const origSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({
      platform: 'instagram',
      urls: domUrls.map((url, i) => ({ url, type: 'image', filename: `post_ABC_${i + 1}` })),
    });

    const downloaded = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloaded.push(opts.url); return downloaded.length; };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(
        { menuItemId: 'socialsnag-download-all', pageUrl: 'https://www.instagram.com/p/ABC/', srcUrl: '' },
        { id: 1, url: 'https://www.instagram.com/p/ABC/' }
      );
    } finally {
      globalThis.chrome.tabs.sendMessage = origSend;
      globalThis.chrome.downloads.download = origDownload;
    }

    expect(downloaded).toEqual(domUrls);
  });
});

describe('context menu click — Instagram feed carousel (no URL shortcode)', () => {
  afterEach(() => resetFetch());

  it('enumerates the full post via the API using a DOM-supplied shortcode', async () => {
    // Feed/grid: the page URL is instagram.com/ with no /p/<code>/, so the
    // API-first block is skipped. The content script found the post's shortcode
    // from its DOM permalink but returned only the ~2 lazy-rendered slides. The
    // background must still enumerate the whole carousel through the API.
    installFetch((url) => {
      if (!url.includes('i.instagram.com')) return null;
      return {
        status: 200,
        json: { items: [{ carousel_media: [
          igImgSlide('https://cdn.cdninstagram.com/1.jpg'),
          igVidSlide('https://cdn.cdninstagram.com/2.mp4'),
          igImgSlide('https://cdn.cdninstagram.com/3.jpg'),
        ] }] },
      };
    });

    const origSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({
      platform: 'instagram',
      shortcode: 'ABC',
      urls: [
        { url: 'https://scontent.cdninstagram.com/dom1.jpg', type: 'image', filename: 'post_ABC_1' },
        { url: 'https://scontent.cdninstagram.com/dom2.jpg', type: 'image', filename: 'post_ABC_2' },
      ],
    });

    const downloaded = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloaded.push(opts.url); return downloaded.length; };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(
        { menuItemId: 'socialsnag-download-all', pageUrl: 'https://www.instagram.com/', srcUrl: '' },
        { id: 1, url: 'https://www.instagram.com/' }
      );
    } finally {
      globalThis.chrome.tabs.sendMessage = origSend;
      globalThis.chrome.downloads.download = origDownload;
    }

    // All three carousel items, not the two partial DOM slides.
    expect(downloaded).toEqual([
      'https://cdn.cdninstagram.com/1.jpg',
      'https://cdn.cdninstagram.com/2.mp4',
      'https://cdn.cdninstagram.com/3.jpg',
    ]);
  });
});

describe('zip download flow', () => {
  // The revoke listener is now a module-level singleton registered at import,
  // not one per zip, so _listeners[0] is already deterministic. Clearing it here
  // would delete it for the rest of the file.
  afterEach(() => resetFetch());

  // Pretend the offscreen doc exists and capture every message sent to it. The
  // 'zip' action resolves to a blob URL (or a failure when zipOk is false);
  // everything else (revoke) resolves ok. Returns { sent, restore }.
  function installOffscreenMock(zipOk = true) {
    const origGetContexts = globalThis.chrome.runtime.getContexts;
    const origSendMessage = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.getContexts = async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }];
    const sent = [];
    globalThis.chrome.runtime.sendMessage = async (msg) => {
      sent.push(msg);
      if (msg.action === 'zip') return zipOk ? { ok: true, url: 'blob:zip1' } : { ok: false };
      return { ok: true };
    };
    return {
      sent,
      restore() {
        globalThis.chrome.runtime.getContexts = origGetContexts;
        globalThis.chrome.runtime.sendMessage = origSendMessage;
      },
    };
  }

  const imgItems = [
    { url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'a' },
    { url: 'https://cdn.bsky.app/img/b.jpg', type: 'image', filename: 'b' },
  ];

  it('zips two valid items, downloads one .zip, and revokes the blob on completion', async () => {
    const off = installOffscreenMock(true);
    const downloads = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloads.push(opts); return 42; };

    try {
      const result = await downloadItemsAsZip(imgItems, 'bluesky');
      expect(result).toBe(2);

      const zipMsg = off.sent.find((m) => m.action === 'zip');
      expect(zipMsg.files).toHaveLength(2);
      expect(zipMsg.files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);

      expect(downloads).toHaveLength(1);
      expect(downloads[0].url).toBe('blob:zip1');
      expect(downloads[0].filename.endsWith('.zip')).toBe(true);

      // The blob is revoked only once the download reaches a terminal state.
      expect(off.sent.some((m) => m.action === 'revoke')).toBe(false);
      await globalThis.chrome.downloads.onChanged._listeners[0]({ id: 42, state: { current: 'complete' } });
      expect(off.sent).toContainEqual({ target: 'offscreen', action: 'revoke', url: 'blob:zip1' });
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('revokes when the download record disappears before tracking finishes', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    const origSearch = globalThis.chrome.downloads.search;
    globalThis.chrome.downloads.download = async () => 43;
    globalThis.chrome.downloads.search = async () => [];

    try {
      await downloadItemsAsZip(imgItems, 'bluesky');
      expect(off.sent).toContainEqual({
        target: 'offscreen',
        action: 'revoke',
        url: 'blob:zip1',
      });
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      globalThis.chrome.downloads.search = origSearch;
      off.restore();
    }
  });

  it('skips a url that fails validation before it enters the archive', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async () => 7;

    try {
      const items = [
        { url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'a' },
        { url: 'https://evil.example/x.jpg', type: 'image', filename: 'x' },
      ];
      const result = await downloadItemsAsZip(items, 'bluesky');
      expect(result).toBe(1);

      const zipMsg = off.sent.find((m) => m.action === 'zip');
      expect(zipMsg.files).toHaveLength(1);
      expect(zipMsg.files[0].name).toBe('a.jpg');
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('neutralizes a traversal path smuggled through the ?format= extension', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async () => 8;

    try {
      // guessExtension echoes the ?format= value verbatim, so a crafted format
      // can carry / and .. into the entry name unless the whole name is sanitized.
      const result = await downloadItemsAsZip([
        { url: 'https://cdn.bsky.app/img/a?format=../../evil.sh', type: 'image', filename: 'slide' },
      ], 'bluesky');
      expect(result).toBe(1);

      const zipMsg = off.sent.find((m) => m.action === 'zip');
      expect(zipMsg.files[0].name).not.toContain('/');
      expect(zipMsg.files[0].name).not.toContain('..');
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('returns false and does not download when the zip build fails', async () => {
    const off = installOffscreenMock(false); // 'zip' action resolves { ok:false }
    const downloads = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloads.push(opts); return 1; };

    try {
      const result = await downloadItemsAsZip(imgItems, 'bluesky');
      expect(result).toBe(false);
      expect(downloads).toHaveLength(0);
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('forces a single .zip download from the zip menu item', async () => {
    const off = installOffscreenMock(true);
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({
      platform: 'bluesky',
      urls: [
        { url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'bsky_a' },
        { url: 'https://cdn.bsky.app/img/b.jpg', type: 'image', filename: 'bsky_b' },
      ],
    });
    const downloads = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloads.push(opts); return 99; };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(
        { menuItemId: 'socialsnag-download-zip', pageUrl: 'https://bsky.app/profile/x/post/1', srcUrl: '' },
        { id: 5, url: 'https://bsky.app/profile/x/post/1' }
      );
      expect(downloads).toHaveLength(1);
      expect(downloads[0].filename.endsWith('.zip')).toBe(true);
    } finally {
      globalThis.chrome.tabs.sendMessage = origTabsSend;
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('honors the zipMultiPosts setting for the download-all menu item', async () => {
    const allInfo = { menuItemId: 'socialsnag-download-all', pageUrl: 'https://bsky.app/profile/x/post/1', srcUrl: '' };
    const allTab = { id: 5, url: 'https://bsky.app/profile/x/post/1' };
    const twoItems = () => ({
      platform: 'bluesky',
      urls: [
        { url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'bsky_a' },
        { url: 'https://cdn.bsky.app/img/b.jpg', type: 'image', filename: 'bsky_b' },
      ],
    });
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => twoItems();

    // Part 1: setting on -> one .zip download, a 'zip' message was sent.
    const offOn = installOffscreenMock(true);
    const downloadsOn = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloadsOn.push(opts); return 21; };
    try {
      await globalThis.chrome.storage.sync.set({ zipMultiPosts: true });
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(allInfo, allTab);
      expect(downloadsOn).toHaveLength(1);
      expect(downloadsOn[0].filename.endsWith('.zip')).toBe(true);
      expect(offOn.sent.some((m) => m.action === 'zip')).toBe(true);
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      offOn.restore();
      await globalThis.chrome.storage.sync.remove('zipMultiPosts');
    }

    // Part 2: setting off -> two individual downloads, no 'zip' message.
    const offOff = installOffscreenMock(true);
    const downloadsOff = [];
    const origDownload2 = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloadsOff.push(opts); return downloadsOff.length; };
    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(allInfo, allTab);
      expect(downloadsOff).toHaveLength(2);
      expect(downloadsOff.every((d) => !d.filename.endsWith('.zip'))).toBe(true);
      expect(offOff.sent.some((m) => m.action === 'zip')).toBe(false);
    } finally {
      globalThis.chrome.downloads.download = origDownload2;
      offOff.restore();
      globalThis.chrome.tabs.sendMessage = origTabsSend;
    }
  });

  it('degrades a forced zip to a normal download when only one item resolves', async () => {
    const off = installOffscreenMock(true);
    const origTabsSend = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = async () => ({
      platform: 'bluesky',
      urls: [{ url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'bsky_a' }],
    });
    const downloads = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloads.push(opts); return 3; };

    try {
      const handler = globalThis.chrome.contextMenus.onClicked._listeners[0];
      await handler(
        { menuItemId: 'socialsnag-download-zip', pageUrl: 'https://bsky.app/profile/x/post/1', srcUrl: '' },
        { id: 5, url: 'https://bsky.app/profile/x/post/1' }
      );
      // The >= 2 guard means one item never zips; it downloads directly.
      expect(off.sent.some((m) => m.action === 'zip')).toBe(false);
      expect(downloads).toHaveLength(1);
      expect(downloads[0].filename.endsWith('.zip')).toBe(false);
    } finally {
      globalThis.chrome.tabs.sendMessage = origTabsSend;
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('bails to per-file when any item still needs a video lookup', async () => {
    const off = installOffscreenMock(true);
    const downloads = [];
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async (opts) => { downloads.push(opts); return 1; };

    try {
      const result = await downloadItemsAsZip([
        { url: 'https://cdn.bsky.app/img/a.jpg', type: 'image', filename: 'a' },
        { type: 'video', filename: 'v', needsVideoLookup: true },
      ], 'bluesky');
      expect(result).toBe(false);
      expect(off.sent.some((m) => m.action === 'zip')).toBe(false);
      expect(downloads).toHaveLength(0);
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('records the archive with no url in history', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async () => 55;

    try {
      await globalThis.chrome.storage.local.set({ downloadHistory: [] });
      const result = await downloadItemsAsZip(imgItems, 'bluesky');
      expect(result).toBe(2);

      const { downloadHistory } = await globalThis.chrome.storage.local.get({ downloadHistory: [] });
      expect(downloadHistory).toHaveLength(1);
      const entry = downloadHistory[0];
      expect('url' in entry).toBe(false);
      expect(JSON.stringify(entry)).not.toContain('blob:');
      expect(entry.filename.endsWith('.zip')).toBe(true);
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      off.restore();
    }
  });

  it('revokes the blob when an interrupted download cannot resume', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    const origSearch = globalThis.chrome.downloads.search;
    globalThis.chrome.downloads.download = async () => 63;
    globalThis.chrome.downloads.search = async () => [{
      id: 63,
      state: 'interrupted',
      canResume: false,
    }];

    try {
      const result = await downloadItemsAsZip(imgItems, 'bluesky');
      expect(result).toBe(2);

      await globalThis.chrome.downloads.onChanged._listeners[0]({ id: 63, state: { current: 'interrupted' } });
      expect(off.sent).toContainEqual({ target: 'offscreen', action: 'revoke', url: 'blob:zip1' });
    } finally {
      globalThis.chrome.downloads.download = origDownload;
      globalThis.chrome.downloads.search = origSearch;
      off.restore();
    }
  });
});

describe('context menu registration', () => {
  it('nests the four actions under one SocialSnag parent', () => {
    const created = [];
    const origCreate = globalThis.chrome.contextMenus.create;
    globalThis.chrome.contextMenus.create = (opts) => { created.push(opts); };
    try {
      // onInstalled listener 0 is the menu registration (listener 1 is
      // advanced-mode init); firing all is order-independent and safe.
      globalThis.chrome.runtime.onInstalled._listeners.forEach((fn) => fn());
    } finally {
      globalThis.chrome.contextMenus.create = origCreate;
    }

    const parent = created.find((m) => m.id === 'socialsnag-parent');
    expect(parent).toBeTruthy();
    expect(parent.title).toBe('SocialSnag');
    expect(parent.parentId).toBeUndefined();
    expect(parent.documentUrlPatterns).toBeTruthy();

    const children = created.filter((m) => m.parentId === 'socialsnag-parent');
    expect(children.map((c) => c.id).sort()).toEqual([
      'socialsnag-copy-url',
      'socialsnag-download-all',
      'socialsnag-download-single',
      'socialsnag-download-zip',
    ]);
    // Children carry no "SocialSnag:" prefix — the parent supplies it.
    children.forEach((c) => expect(c.title.startsWith('SocialSnag')).toBe(false));
    // Every child must repeat the full contexts, or Chrome defaults it to
    // ['page'] and the action disappears on image/video right-clicks.
    children.forEach((c) => {
      expect(c.contexts).toEqual(['page', 'image', 'video', 'link']);
      expect(c.documentUrlPatterns).toBeTruthy();
    });
  });
});

describe('zip blob revocation lifecycle', () => {
  const KEY = 'pendingBlobRevokes';
  let origSendMessage;
  let origSearch;
  let revoked;

  const fire = async (delta) => {
    for (const fn of globalThis.chrome.downloads.onChanged._listeners) await fn(delta);
  };

  const fireErased = async (downloadId) => {
    for (const fn of globalThis.chrome.downloads.onErased._listeners) await fn(downloadId);
  };

  beforeEach(async () => {
    revoked = [];
    origSendMessage = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = async (msg) => {
      if (msg?.action === 'revoke') revoked.push(msg.url);
      return { ok: true };
    };
    origSearch = globalThis.chrome.downloads.search;
    await globalThis.chrome.storage.session.set({ [KEY]: { 7: 'blob:zip-7' } });
  });

  afterEach(async () => {
    globalThis.chrome.runtime.sendMessage = origSendMessage;
    globalThis.chrome.downloads.search = origSearch;
    await globalThis.chrome.storage.session.set({ [KEY]: {} });
  });

  it('revokes a tracked blob with no per-download listener registered', async () => {
    // Only session storage knows about id 7 -- this is the state a restarted
    // service worker wakes up in, where the old per-download listener is gone.
    await fire({ id: 7, state: { current: 'complete' } });
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('keeps the blob when an interrupted download can still resume', async () => {
    globalThis.chrome.downloads.search = async () => [{ id: 7, canResume: true }];
    await fire({ id: 7, state: { current: 'interrupted' } });
    expect(revoked).toEqual([]);
    const stored = await globalThis.chrome.storage.session.get(KEY);
    expect(stored[KEY]['7']).toBe('blob:zip-7');
  });

  it('revokes when an interrupted download cannot resume', async () => {
    globalThis.chrome.downloads.search = async () => [{
      id: 7,
      state: 'interrupted',
      canResume: false,
    }];
    await fire({ id: 7, state: { current: 'interrupted' } });
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('revokes an interrupted download whose record is gone', async () => {
    globalThis.chrome.downloads.search = async () => [];
    await fire({ id: 7, state: { current: 'interrupted' } });
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('keeps an interrupted blob when its download-state query fails', async () => {
    globalThis.chrome.downloads.search = async () => {
      throw new Error('downloads database unavailable');
    };
    await fire({ id: 7, state: { current: 'interrupted' } });
    expect(revoked).toEqual([]);
    const stored = await globalThis.chrome.storage.session.get(KEY);
    expect(stored[KEY]['7']).toBe('blob:zip-7');
  });

  it('revokes when an interrupted download becomes non-resumable without a state delta', async () => {
    globalThis.chrome.downloads.search = async () => [{
      id: 7,
      state: 'interrupted',
      canResume: false,
    }];
    await fire({ id: 7, canResume: { previous: true, current: false } });
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('revokes when Chrome erases the download record', async () => {
    await fireErased(7);
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('drops the entry so a repeated event cannot double-revoke', async () => {
    await fire({ id: 7, state: { current: 'complete' } });
    await fire({ id: 7, state: { current: 'complete' } });
    expect(revoked).toEqual(['blob:zip-7']);
  });

  it('ignores downloads it is not tracking', async () => {
    await fire({ id: 999, state: { current: 'complete' } });
    expect(revoked).toEqual([]);
  });
});

describe('resolveBaseFilename', () => {
  const item = {
    type: 'image',
    filename: 'photo_999_2',
    meta: { postId: '999', username: 'someone', index: 2 },
  };

  // The opt-in is the whole compatibility story: an update must not rename the
  // files of every user who never asked for a template.
  it('keeps the resolver name when no template is configured', () => {
    expect(resolveBaseFilename(item, 'facebook', '', 2)).toBe('photo_999_2');
    expect(resolveBaseFilename(item, 'facebook', undefined, 2)).toBe('photo_999_2');
  });

  it('falls back to platform and index when the resolver named nothing', () => {
    expect(resolveBaseFilename({ type: 'image' }, 'facebook', '', 3)).toBe('facebook_3');
  });

  it('renders a configured template from item.meta', () => {
    expect(resolveBaseFilename(item, 'facebook', '{platform}_{username}_{postId}_{index}', 2))
      .toBe('facebook_someone_999_2');
  });

  it('uses the caller index, not the one on meta', () => {
    // The zip path numbers by position in the archive, which is the number the user
    // sees; meta.index is whatever the resolver happened to assign.
    expect(resolveBaseFilename(item, 'facebook', 'photo_{index}', 7)).toBe('photo_7');
  });

  it('degrades to a shorter name when the resolver supplies no meta', () => {
    // A template written for a platform that exposes a username must not produce
    // gaps or the literal word undefined on one that does not.
    const bare = { type: 'image', filename: 'photo_1' };
    expect(resolveBaseFilename(bare, 'twitter', '{platform}_{username}_{postId}_{index}', 1))
      .toBe('twitter_1');
  });

  it('falls back rather than returning an empty name', () => {
    // Validation refuses a template that always renders empty, but a single item
    // missing every token it names is normal, and a file called only ".jpg" is not
    // an acceptable result.
    const bare = { type: 'image', filename: 'photo_1' };
    expect(resolveBaseFilename(bare, 'twitter', '{postId}{username}', 1)).toBe('photo_1');
  });

  it('includes the type and a date when asked', () => {
    const out = resolveBaseFilename(item, 'facebook', '{date}_{type}_{postId}', 1);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}_image_999$/);
  });
});

describe('formatLocalDate', () => {
  it('formats yyyy-mm-dd with zero padding', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  // The reason this is not toISOString(): that reports UTC, so an evening download
  // west of UTC lands on tomorrow's date. Late local evening is the case where the
  // two disagree, so it is the case worth pinning.
  it('uses the local day, not the UTC one', () => {
    const lateEvening = new Date(2026, 6, 20, 23, 30);
    expect(formatLocalDate(lateEvening)).toBe('2026-07-20');
    // Asserted as a relationship rather than a fixed string, so this holds in CI
    // whatever timezone the runner is set to.
    if (lateEvening.toISOString().slice(0, 10) !== '2026-07-20') {
      expect(formatLocalDate(lateEvening)).not.toBe(lateEvening.toISOString().slice(0, 10));
    }
  });
});

// The whole download path, from a context-menu click to what history records. This
// seam had no harness, which is how the file on disk came to carry the templated name
// while Recent downloads still listed the one the resolver had picked.
describe('context-menu download history', () => {
  // The menu ids are private to background.js; this is the "Download this (HD)" one.
  const MENU_DOWNLOAD_SINGLE = 'socialsnag-download-single';
  const PAGE = 'https://www.facebook.com/photo/?fbid=999';

  let origSendMessage;
  let origDownload;
  let origSearch;

  function clickDownload() {
    const [onClicked] = globalThis.chrome.contextMenus.onClicked._listeners;
    return onClicked({ menuItemId: MENU_DOWNLOAD_SINGLE, pageUrl: PAGE }, { id: 1, url: PAGE });
  }

  beforeEach(() => {
    globalThis.chrome.storage.sync._reset();
    globalThis.chrome.storage.local._reset();
    origSendMessage = globalThis.chrome.tabs.sendMessage;
    origDownload = globalThis.chrome.downloads.download;
    origSearch = globalThis.chrome.downloads.search;
    // The mock's listener array is shared across the file, so the attach/detach
    // assertions below only mean something from a known-empty start.
    globalThis.chrome.downloads.onChanged._listeners.length = 0;
    globalThis.chrome.tabs.sendMessage = async () => ({
      platform: 'facebook',
      urls: [{
        url: 'https://scontent.fbcdn.net/v/photo.jpg',
        type: 'image',
        filename: 'facebook_resolver_name',
        meta: { postId: '999' },
      }],
    });
    globalThis.chrome.downloads.download = async () => 7;
  });

  afterEach(() => {
    globalThis.chrome.tabs.sendMessage = origSendMessage;
    globalThis.chrome.downloads.download = origDownload;
    globalThis.chrome.downloads.search = origSearch;
    globalThis.chrome.storage.sync._reset();
    globalThis.chrome.storage.local._reset();
  });

  it('records the templated name, which is the name the file has', async () => {
    await globalThis.chrome.storage.sync.set({ filenameTemplate: '{platform}_{postId}' });
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory).toHaveLength(1);
    expect(downloadHistory[0].filename).toBe('facebook_999.jpg');
    expect(downloadHistory[0].downloadId).toBe(7);
  });

  it('records the resolver name when no template is configured', async () => {
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_resolver_name.jpg');
  });

  // The name we ask for and the name on disk part company exactly when a template is
  // non-unique: conflictAction:'uniquify' renames the second `facebook_999.jpg` and
  // never tells the requested path. History listing a file that does not exist is the
  // failure this whole return value exists to prevent, so it has to survive the rename.
  it('records the uniquified name when the requested one was already taken', async () => {
    globalThis.chrome.downloads.search = async () => [
      { filename: '/home/joe/Downloads/SocialSnag/facebook/facebook_999 (1).jpg' },
    ];
    await globalThis.chrome.storage.sync.set({ filenameTemplate: '{platform}_{postId}' });
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_999 (1).jpg');
  });

  it('reads a Windows path back to its basename', async () => {
    globalThis.chrome.downloads.search = async () => [
      { filename: 'C:\\Users\\joe\\Downloads\\SocialSnag\\facebook\\facebook_999 (2).jpg' },
    ];
    await globalThis.chrome.storage.sync.set({ filenameTemplate: '{platform}_{postId}' });
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_999 (2).jpg');
  });

  // Chrome names the file asynchronously, so the lookup can land before there is a
  // name -- and that is likeliest on exactly the collisions above, where a template
  // without {index} sends a whole album at one path. The name arrives on onChanged, so
  // waiting for it is what makes the uniquified name recordable at all.
  it('waits for the name Chrome assigns when the immediate lookup has none', async () => {
    globalThis.chrome.downloads.search = async () => {
      // Fire the way Chrome does: after the lookup, onto the listener already attached.
      queueMicrotask(() => {
        for (const l of [...globalThis.chrome.downloads.onChanged._listeners]) {
          l({
            id: 7,
            filename: { current: '/home/joe/Downloads/SocialSnag/facebook/facebook_999 (1).jpg' },
          });
        }
      });
      return [{ state: 'in_progress' }];
    };
    await globalThis.chrome.storage.sync.set({ filenameTemplate: '{platform}_{postId}' });
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_999 (1).jpg');
  });

  // Attaching after the search would drop a delta that fired in between, and onChanged
  // does not replay -- the wait above would then sit until it timed out and record the
  // wrong name. This ordering is the thing that makes it work.
  it('attaches the filename listener before it looks the download up', async () => {
    let listenersAtSearch = -1;
    globalThis.chrome.downloads.search = async () => {
      listenersAtSearch = globalThis.chrome.downloads.onChanged._listeners.length;
      return [{ filename: '/home/joe/Downloads/SocialSnag/facebook/facebook_999.jpg' }];
    };
    await clickDownload();

    expect(listenersAtSearch).toBe(1);
  });

  // The listener and its timer must not outlive the download. One leaks per item
  // otherwise, which on an album is the whole batch.
  it('detaches the filename listener once it has an answer', async () => {
    globalThis.chrome.downloads.search = async () => [
      { filename: '/home/joe/Downloads/SocialSnag/facebook/facebook_999 (1).jpg' },
    ];
    await clickDownload();

    expect(globalThis.chrome.downloads.onChanged._listeners).toHaveLength(0);
  });

  // A download that fails before Chrome ever names it has no delta coming, so the wait
  // has to end by itself rather than hanging the history write. The requested name is
  // the closest thing left: it differs only where Chrome changed it, and Chrome never
  // got that far.
  it('falls back to the requested name when no name ever arrives', async () => {
    vi.useFakeTimers();
    try {
      globalThis.chrome.downloads.search = async () => [{ state: 'in_progress' }];
      const done = clickDownload();
      await vi.advanceTimersByTimeAsync(5000);
      await done;
    } finally {
      vi.useRealTimers();
    }

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_resolver_name.jpg');
  });

  // A download Chrome has already given up on will never fire a filename delta, so
  // waiting on one buys nothing and costs the whole timeout -- and the album loop is
  // sequential, so every item behind it waits too. Real timers here on purpose: if the
  // wait ever came back, this test would take seconds instead of failing on the clock.
  it('does not wait for a name on a download that already failed', async () => {
    globalThis.chrome.downloads.search = async () => [{ state: 'interrupted' }];
    const startedAt = Date.now();
    await clickDownload();
    const elapsed = Date.now() - startedAt;

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_resolver_name.jpg');
    expect(elapsed).toBeLessThan(500);
  });

  it('falls back to the requested name when the lookup itself fails', async () => {
    globalThis.chrome.downloads.search = async () => { throw new Error('no such id'); };
    await clickDownload();

    const { downloadHistory } = globalThis.chrome.storage.local._data();
    expect(downloadHistory[0].filename).toBe('facebook_resolver_name.jpg');
  });

  it('records nothing when the download itself fails', async () => {
    globalThis.chrome.downloads.download = async () => { throw new Error('disk full'); };
    await clickDownload();

    expect(globalThis.chrome.storage.local._data().downloadHistory).toBeUndefined();
  });

  it('does not print media urls when every download fails', async () => {
    // This is the console line a user is most likely to be reading, and pasting
    // into a bug report, at the moment a download breaks -- so it is where the
    // no-url promise in options actually gets tested.
    const warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args));
    globalThis.chrome.downloads.download = async () => { throw new Error('disk full'); };

    await clickDownload();

    const printed = JSON.stringify(warnings);
    expect(printed).not.toMatch(/https?:\/\//);
    expect(printed).not.toMatch(/fbcdn|cdninstagram|twimg|bsky/);
    expect(printed).toContain('facebook_resolver_name');
  });
});

describe('resolveViaApi miss classification', () => {
  // The debug trace exists so a failed download names its own cause. Getting the
  // cause wrong is worse than staying quiet, because it sends the reader after a
  // parsing bug that is not there -- so each of the three misses is pinned here.
  // Without these, deleting one `foundId = true` line leaves the suite green.
  let logged;

  beforeEach(async () => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((line) => logged.push(line));
    globalThis.chrome.storage.sync._reset();
    await globalThis.chrome.storage.sync.set({ resolverDebug: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.resetFetch();
    globalThis.chrome.storage.sync._reset();
  });

  const dispatchLine = () => logged.find((l) => l.includes('api-dispatch'));

  it('says there is no api path at all for a platform that has none', async () => {
    expect((await resolveViaApi('bluesky', 'https://bsky.app/profile/a/post/b')).item).toBeNull();
    expect(dispatchLine()).toBe('socialsnag[bluesky] api-dispatch: empty (no api path for platform)');
  });

  it('blames the url only when the url really carries no id', async () => {
    expect((await resolveViaApi('twitter', 'https://x.com/someone')).item).toBeNull();
    expect(dispatchLine()).toBe('socialsnag[twitter] api-dispatch: empty (no id in url)');
  });

  it('does not blame the url when the id was found but the api had no video', async () => {
    // An image-only tweet: the id parsed fine, the syndication response simply
    // carries no video media. Reporting this as a url problem was the bug.
    globalThis.installFetch(() => ({ status: 200, json: { mediaDetails: [] } }));

    expect((await resolveViaApi('twitter', 'https://x.com/a/status/123')).item).toBeNull();
    expect(dispatchLine()).toBe('socialsnag[twitter] api-dispatch: empty (id found, no video from api)');
  });

  it('reports the hit without a miss line when the api does return a video', async () => {
    globalThis.installFetch(() => ({
      status: 200,
      json: {
        mediaDetails: [{
          type: 'video',
          video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/x.mp4', bitrate: 832000 }] },
        }],
      },
    }));

    const result = await resolveViaApi('twitter', 'https://x.com/a/status/123');
    expect(result.item?.url).toBe('https://video.twimg.com/x.mp4');
    expect(dispatchLine()).toBe('socialsnag[twitter] api-dispatch: ok (1 item)');
  });

  it('stays silent when the user has not enabled debug', async () => {
    globalThis.chrome.storage.sync._reset();
    await resolveViaApi('bluesky', 'https://bsky.app/profile/a/post/b');
    expect(logged).toEqual([]);
  });
});

const LANDING_PAGE_SENDER = {
  origin: 'https://jamditis.github.io',
  url: 'https://jamditis.github.io/socialsnag/',
};

function sendExternal(request, sender = LANDING_PAGE_SENDER) {
  const handler = chrome.runtime.onMessageExternal._listeners[0];
  return new Promise((resolve) => {
    const keepOpen = handler(request, sender, resolve);
    expect(keepOpen).toBe(true);
  });
}

function settleWithin(promise, timeoutMs = 30) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve({ result });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ error });
      },
    );
  });
}

describe('submitted URL external bridge', () => {
  const originalTabs = {
    create: chrome.tabs.create,
    get: chrome.tabs.get,
    remove: chrome.tabs.remove,
    sendMessage: chrome.tabs.sendMessage,
  };
  const originalDownload = chrome.downloads.download;
  const originalSearch = chrome.downloads.search;

  beforeEach(() => {
    chrome.storage.local._reset();
    chrome.storage.sync._reset();
    chrome.tabs.create = originalTabs.create;
    chrome.tabs.get = originalTabs.get;
    chrome.tabs.remove = originalTabs.remove;
    chrome.tabs.sendMessage = originalTabs.sendMessage;
    chrome.downloads.download = originalDownload;
    chrome.downloads.search = originalSearch;
  });

  afterEach(() => {
    resetFetch();
    chrome.tabs.create = originalTabs.create;
    chrome.tabs.get = originalTabs.get;
    chrome.tabs.remove = originalTabs.remove;
    chrome.tabs.sendMessage = originalTabs.sendMessage;
    chrome.downloads.download = originalDownload;
    chrome.downloads.search = originalSearch;
  });

  it('exposes only the exact GitHub Pages path in externally_connectable', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(manifest.externally_connectable).toEqual({
      matches: ['https://jamditis.github.io/socialsnag/*'],
    });
  });

  it('uses a publishable feature version consistently', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

    expect(manifest.version).toBe('1.3.0');
    expect(packageJson.version).toBe(manifest.version);
    expect(packageLock.version).toBe(manifest.version);
    expect(packageLock.packages[''].version).toBe(manifest.version);
  });

  it.each([
    { origin: 'http://jamditis.github.io', url: 'http://jamditis.github.io/socialsnag/' },
    { origin: 'https://jamditis.github.io', url: 'https://jamditis.github.io/socialsnag-evil/' },
    { origin: 'https://jamditis.github.io', url: 'https://jamditis.github.io/not-socialsnag/' },
    { origin: 'https://jamditis.github.io.evil.test', url: 'https://jamditis.github.io.evil.test/socialsnag/' },
    { origin: 'https://jamditis.github.io:8443', url: 'https://jamditis.github.io:8443/socialsnag/' },
    { origin: 'https://jamditis.github.io', url: 'https://user@jamditis.github.io/socialsnag/' },
  ])('rejects an external sender outside the exact site boundary', async (sender) => {
    const create = vi.fn();
    chrome.tabs.create = create;

    await expect(sendExternal(
      { action: 'downloadSubmittedUrl', url: 'https://x.com/user/status/123' },
      sender,
    )).resolves.toEqual({ ok: false, code: 'invalid_sender', platform: null, count: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts the exact origin with a separately validated relative sender path', async () => {
    const create = vi.fn();
    chrome.tabs.create = create;

    await expect(sendExternal(
      { action: 'downloadSubmittedUrl', url: 'https://x.com/settings' },
      { origin: 'https://jamditis.github.io', url: '/socialsnag/index.html' },
    )).resolves.toEqual({ ok: false, code: 'invalid_url', platform: null, count: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'other', url: 'https://x.com/user/status/123' }, 'invalid_request'],
    [{ action: 'downloadSubmittedUrl' }, 'invalid_request'],
    [{ action: 'downloadSubmittedUrl', url: 'https://x.com/user/status/123', extra: true }, 'invalid_request'],
    [{ action: 'downloadSubmittedUrl', url: `https://x.com/user/status/${'1'.repeat(2100)}` }, 'invalid_url'],
  ])('rejects an invalid request before opening a tab', async (request, code) => {
    const create = vi.fn();
    chrome.tabs.create = create;

    await expect(sendExternal(request)).resolves.toEqual({
      ok: false,
      code,
      platform: null,
      count: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects malformed and unsupported URLs before opening a tab', async () => {
    const create = vi.fn();
    chrome.tabs.create = create;

    await expect(orchestrateSubmittedDownload('not a url')).resolves.toEqual({
      ok: false, code: 'invalid_url', platform: null, count: 0,
    });
    await expect(orchestrateSubmittedDownload('https://example.com/post/1')).resolves.toEqual({
      ok: false, code: 'unsupported_url', platform: null, count: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['twitter', 'https://x.com/user/status/123'],
    ['instagram', 'https://www.instagram.com/p/ABC/'],
  ])('stops a submitted %s job when that platform is disabled', async (platform, url) => {
    await chrome.storage.sync.set({ [`platform_${platform}`]: false });
    const submittedFetch = vi.fn();
    chrome.tabs.create = vi.fn();
    chrome.tabs.sendMessage = vi.fn();
    chrome.downloads.download = vi.fn();

    const result = await orchestrateSubmittedDownload(url, { submittedFetch });

    expect(result).toEqual({
      ok: false, code: 'platform_disabled', platform, count: 0,
    });
    expect(submittedFetch).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('downloads Instagram media through the authenticated API without opening a tab', async () => {
    installFetch((url) => url.includes('i.instagram.com') ? {
      status: 200,
      json: { items: [{ carousel_media: [
        igImgSlide('https://cdn.cdninstagram.com/one.jpg'),
        igVidSlide('https://cdn.cdninstagram.com/two.mp4'),
      ] }] },
    } : null);
    const create = vi.fn();
    const download = vi.fn()
      .mockResolvedValueOnce(41)
      .mockResolvedValueOnce(42);
    chrome.tabs.create = create;
    chrome.downloads.download = download;
    chrome.downloads.search = async ({ id }) => [{
      id,
      state: 'complete',
      filename: `/downloads/${id === 41 ? 'one.jpg' : 'two.mp4'}`,
    }];

    const result = await orchestrateSubmittedDownload('https://www.instagram.com/p/ABC/');

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'instagram', count: 2 });
    expect(create).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(2);
    const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });
    expect(downloadHistory).toHaveLength(2);
    expect(downloadHistory.every((entry) => !('url' in entry))).toBe(true);
  });

  it('downloads an active Instagram story through the authenticated API without opening a tab', async () => {
    installFetch((url) => {
      if (url.includes('web_profile_info')) {
        return { status: 200, json: { data: { user: { id: '55' } } } };
      }
      if (url.includes('reels_media')) {
        return {
          status: 200,
          json: { reels_media: [{ items: [
            igStoryImg('123', 'https://cdn.cdninstagram.com/story.jpg'),
          ] }] },
        };
      }
      return null;
    });
    chrome.tabs.create = vi.fn();
    chrome.downloads.download = vi.fn(async () => 43);
    chrome.downloads.search = async () => [{
      id: 43, state: 'complete', filename: '/downloads/story_123.jpg',
    }];

    const result = await orchestrateSubmittedDownload(
      'https://www.instagram.com/stories/natgeo/123/',
    );

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'instagram', count: 1 });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth_required'],
    [429, 'rate_limited'],
  ])('returns a stable Instagram API failure for status %s', async (status, code) => {
    installFetch(() => ({ status, json: {} }));
    chrome.tabs.create = vi.fn();

    const result = await orchestrateSubmittedDownload('https://www.instagram.com/p/ABC/');

    expect(result).toEqual({ ok: false, code, platform: 'instagram', count: 0 });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('downloads multiple tab-resolved files, records history, redacts URLs, and closes the created tab', async () => {
    const remove = vi.fn();
    chrome.tabs.create = vi.fn(async () => ({ id: 77, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 77, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = remove;
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'twitter',
      urls: [
        { url: 'https://pbs.twimg.com/media/one.jpg', type: 'image', filename: 'tweet_1_1' },
        { url: 'https://pbs.twimg.com/media/two.jpg', type: 'image', filename: 'tweet_1_2' },
      ],
    }));
    chrome.downloads.download = vi.fn()
      .mockResolvedValueOnce(51)
      .mockResolvedValueOnce(52);
    chrome.downloads.search = async ({ id }) => [{
      id,
      state: 'complete',
      filename: `/downloads/tweet_${id}.jpg`,
    }];

    const result = await orchestrateSubmittedDownload('https://x.com/user/status/123');

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'twitter', count: 2 });
    expect(Object.keys(result).sort()).toEqual(['code', 'count', 'ok', 'platform']);
    expect(JSON.stringify(result)).not.toContain('x.com/user/status');
    expect(JSON.stringify(result)).not.toContain('twimg.com');
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(77);
    const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });
    expect(downloadHistory).toHaveLength(2);
  });

  it.each([
    ['https://x.com/i/web/status/123', 'https://x.com/user/status/123'],
    ['https://twitter.com/user/status/123', 'https://twitter.com/i/web/status/123'],
  ])('keeps the submitted X post identity across a canonical redirect', async (submitted, finalUrl) => {
    chrome.tabs.create = vi.fn(async () => ({ id: 75, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 75, status: 'complete', url: finalUrl,
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'twitter',
      urls: [{
        url: 'https://pbs.twimg.com/media/canonical.jpg',
        type: 'image',
        filename: 'tweet_123',
      }],
    }));
    chrome.downloads.download = vi.fn(async () => 49);
    chrome.downloads.search = async () => [{
      id: 49, state: 'complete', filename: '/downloads/tweet_123.jpg',
    }];

    const result = await orchestrateSubmittedDownload(submitted);

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'twitter', count: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(75, {
      action: 'resolvePage',
      pageUrl: finalUrl,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(75);
  });

  it('caps a resolved post before downloading', async () => {
    const urls = Array.from({ length: 25 }, (_, index) => ({
      url: `https://pbs.twimg.com/media/${index}.jpg`,
      type: 'image',
      filename: `tweet_${index}`,
    }));
    chrome.tabs.create = vi.fn(async () => ({ id: 76, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 76, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({ platform: 'twitter', urls }));
    chrome.downloads.download = vi.fn(async () => 50);
    chrome.downloads.search = async () => [{
      id: 50, state: 'complete', filename: '/downloads/tweet.jpg',
    }];

    const result = await orchestrateSubmittedDownload('https://x.com/user/status/123');

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'twitter', count: 20 });
    expect(chrome.downloads.download).toHaveBeenCalledTimes(20);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(76);
  });

  it('times out a tab that never completes and still closes it', async () => {
    const remove = vi.fn();
    chrome.tabs.create = vi.fn(async () => ({ id: 78, status: 'loading' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 78, status: 'loading', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = remove;
    chrome.tabs.sendMessage = vi.fn();

    const result = await orchestrateSubmittedDownload(
      'https://x.com/user/status/123',
      { tabLoadTimeoutMs: 5, retryDelayMs: 0 },
    );

    expect(result).toEqual({
      ok: false, code: 'resolution_timeout', platform: 'twitter', count: 0,
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(78);
  });

  it('retries while SPA media renders, then downloads the resolved item', async () => {
    chrome.tabs.create = vi.fn(async () => ({ id: 79, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 79,
      status: 'complete',
      url: 'https://bsky.app/profile/a.bsky.social/post/3abc',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('content script not ready'))
      .mockResolvedValueOnce({ urls: [], platform: 'bluesky' })
      .mockResolvedValueOnce({
        urls: [{
          url: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:a/bafk@jpeg',
          type: 'image',
          filename: 'post_3abc',
        }],
        platform: 'bluesky',
      });
    chrome.downloads.download = vi.fn(async () => 61);
    chrome.downloads.search = async () => [{
      id: 61, state: 'complete', filename: '/downloads/post_3abc.jpg',
    }];

    const result = await orchestrateSubmittedDownload(
      'https://bsky.app/profile/a.bsky.social/post/3abc',
      { resolveAttempts: 3, retryDelayMs: 0 },
    );

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'bluesky', count: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(79, {
      action: 'resolvePage',
      pageUrl: 'https://bsky.app/profile/a.bsky.social/post/3abc',
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(79);
  });

  it('resolves a Facebook share URL through its validated canonical redirect URL', async () => {
    const finalUrl = 'https://www.facebook.com/example/posts/9876543210/?mibextid=abc';
    chrome.tabs.create = vi.fn(async () => ({ id: 85, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({ id: 85, status: 'complete', url: finalUrl }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'facebook',
      urls: [{
        url: 'https://scontent.xx.fbcdn.net/9876543210.jpg',
        type: 'image',
        filename: 'photo_9876543210',
      }],
    }));
    chrome.downloads.download = vi.fn(async () => 86);
    chrome.downloads.search = async () => [{
      id: 86, state: 'complete', filename: '/downloads/photo_9876543210.jpg',
    }];

    const result = await orchestrateSubmittedDownload(
      'https://www.facebook.com/share/p/AbC_def-123/',
    );

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'facebook', count: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(85, {
      action: 'resolvePage',
      pageUrl: finalUrl,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(85);
  });

  it('keeps a modern Facebook photo URL anchored through its canonical redirect', async () => {
    const submitted = 'https://www.facebook.com/photo/?fbid=1234567890';
    const finalUrl = 'https://www.facebook.com/example/photos/a.42/1234567890/';
    chrome.tabs.create = vi.fn(async () => ({ id: 86, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({ id: 86, status: 'complete', url: finalUrl }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'facebook',
      urls: [{
        url: 'https://scontent.xx.fbcdn.net/1234567890.jpg',
        type: 'image',
        filename: 'photo_1234567890',
      }],
    }));
    chrome.downloads.download = vi.fn(async () => 87);
    chrome.downloads.search = async () => [{
      id: 87, state: 'complete', filename: '/downloads/photo_1234567890.jpg',
    }];

    const result = await orchestrateSubmittedDownload(submitted);

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'facebook', count: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(86, {
      action: 'resolvePage',
      pageUrl: finalUrl,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(86);
  });

  it.each([
    {
      submitted: 'https://x.com/user/status/123',
      finalUrl: 'https://x.com/other/status/999',
      platform: 'twitter',
    },
    {
      submitted: 'https://x.com/i/web/status/123',
      finalUrl: 'https://x.com/other/status/999',
      platform: 'twitter',
    },
    {
      submitted: 'https://www.facebook.com/example/posts/111/',
      finalUrl: 'https://www.facebook.com/example/posts/222/',
      platform: 'facebook',
    },
    {
      submitted: 'https://bsky.app/profile/alice.bsky.social/post/3loriginal',
      finalUrl: 'https://bsky.app/profile/other.bsky.social/post/3ldifferent',
      platform: 'bluesky',
    },
  ])('rejects same-platform substitution of the submitted $platform post', async ({
    submitted,
    finalUrl,
    platform,
  }) => {
    chrome.tabs.create = vi.fn(async () => ({ id: 88, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({ id: 88, status: 'complete', url: finalUrl }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({ urls: [], platform }));

    const result = await orchestrateSubmittedDownload(submitted, { resolveAttempts: 1 });

    expect(result).toEqual({
      ok: false, code: 'access_or_unavailable', platform, count: 0,
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(88);
  });

  it('resolves a Bluesky DID through AppView and keeps its canonical handle internal', async () => {
    const submitted = 'https://bsky.app/profile/did:plc:abc123/post/3lrequested';
    const profileFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ handle: 'alice.bsky.social' }),
    }));
    chrome.tabs.create = vi.fn(async () => ({ id: 89, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 89, status: 'complete', url: submitted,
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'bluesky',
      urls: [{
        url: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/3lrequested@jpeg',
        type: 'image',
        filename: 'post_3lrequested',
      }],
    }));
    chrome.downloads.download = vi.fn(async () => 90);
    chrome.downloads.search = async () => [{
      id: 90, state: 'complete', filename: '/downloads/post_3lrequested.jpg',
    }];

    const result = await orchestrateSubmittedDownload(submitted, { profileFetch });

    expect(result).toEqual({ ok: true, code: 'ok', platform: 'bluesky', count: 1 });
    expect(profileFetch).toHaveBeenCalledWith(
      'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aabc123',
      expect.objectContaining({
        credentials: 'omit',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(89, {
      action: 'resolvePage',
      pageUrl: submitted,
      canonicalHandle: 'alice.bsky.social',
    });
    expect(JSON.stringify(result)).not.toContain('alice.bsky.social');
    expect(chrome.tabs.remove).toHaveBeenCalledWith(89);
  });

  it.each([
    { ok: false, status: 503, json: async () => ({}) },
    { ok: true, status: 200, json: async () => ({ handle: 'not a handle' }) },
  ])('reports an unavailable DID profile lookup without opening a tab', async (response) => {
    const profileFetch = vi.fn(async () => response);
    chrome.tabs.create = vi.fn();
    chrome.tabs.sendMessage = vi.fn();

    const result = await orchestrateSubmittedDownload(
      'https://bsky.app/profile/did:plc:abc123/post/3lrequested',
      { profileFetch },
    );

    expect(result).toEqual({
      ok: false, code: 'access_or_unavailable', platform: 'bluesky', count: 0,
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      platform: 'instagram',
      url: 'https://www.instagram.com/p/ABC/',
      fetchOption: 'submittedFetch',
      replaceGlobalFetch: true,
    },
    {
      platform: 'bluesky',
      url: 'https://bsky.app/profile/did:plc:abc123/post/3lrequested',
      fetchOption: 'profileFetch',
      replaceGlobalFetch: false,
    },
  ])('aborts a never-settling submitted $platform fetch at its hard deadline', async ({
    platform,
    url,
    fetchOption,
    replaceGlobalFetch,
  }) => {
    const originalFetch = globalThis.fetch;
    let releaseFetch;
    let receivedSignal;
    const neverFetch = vi.fn((_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((resolve) => { releaseFetch = resolve; });
    });
    if (replaceGlobalFetch) globalThis.fetch = neverFetch;

    try {
      const operation = orchestrateSubmittedDownload(url, {
        operationTimeoutMs: 5,
        [fetchOption]: neverFetch,
      });
      const settled = await settleWithin(operation);
      releaseFetch?.({ ok: false, status: 503, json: async () => ({}) });
      if (!settled) await operation;

      expect(settled?.result).toEqual({
        ok: false, code: 'resolution_timeout', platform, count: 0,
      });
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts a stalled submitted X video lookup, closes the tab, and accepts the next job', async () => {
    const originalFetch = globalThis.fetch;
    const nativeSetTimeout = globalThis.setTimeout;
    let releaseFetch;
    let receivedSignal;
    const neverFetch = vi.fn((_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((resolve) => { releaseFetch = resolve; });
    });
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, delay, ...args) => (
        nativeSetTimeout(callback, delay === 15000 ? 5 : delay, ...args)
      ));
    globalThis.fetch = neverFetch;
    chrome.tabs.create = vi.fn()
      .mockResolvedValueOnce({ id: 92, status: 'complete' })
      .mockResolvedValueOnce({ id: 93, status: 'complete' });
    chrome.tabs.get = vi.fn(async (id) => ({
      id,
      status: 'complete',
      url: `https://x.com/user/status/${id === 92 ? '123' : '456'}`,
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn()
      .mockResolvedValueOnce({
        platform: 'twitter',
        urls: [{
          type: 'video',
          filename: 'tweet_123',
          tweetId: '123',
          needsVideoLookup: true,
        }],
      })
      .mockResolvedValueOnce({
        platform: 'twitter',
        urls: [{
          url: 'https://pbs.twimg.com/media/next.jpg',
          type: 'image',
          filename: 'tweet_456',
        }],
      });
    chrome.downloads.download = vi.fn(async () => 94);
    chrome.downloads.search = async () => [{
      id: 94, state: 'complete', filename: '/downloads/tweet_456.jpg',
    }];

    try {
      const first = sendExternal({
        action: 'downloadSubmittedUrl',
        url: 'https://x.com/user/status/123',
      });
      const settled = await settleWithin(first);
      if (!settled) {
        releaseFetch?.({ ok: false, status: 503, json: async () => ({}) });
        await first;
      }

      expect(settled?.result).toEqual({
        ok: false, code: 'resolution_timeout', platform: 'twitter', count: 0,
      });
      expect(receivedSignal?.aborted).toBe(true);
      expect(chrome.tabs.remove).toHaveBeenCalledWith(92);

      await expect(sendExternal({
        action: 'downloadSubmittedUrl',
        url: 'https://x.com/user/status/456',
      })).resolves.toEqual({
        ok: true, code: 'ok', platform: 'twitter', count: 1,
      });
      expect(chrome.tabs.remove).toHaveBeenCalledWith(93);
      expect(chrome.downloads.download).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
      timeoutSpy.mockRestore();
    }
  });

  it('reports a partial result when a submitted X video lookup times out after an image', async () => {
    let releaseFetch;
    let receivedSignal;
    const neverFetch = vi.fn((_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((resolve) => { releaseFetch = resolve; });
    });
    chrome.tabs.create = vi.fn(async () => ({ id: 95, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 95, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'twitter',
      urls: [
        {
          url: 'https://pbs.twimg.com/media/one.jpg',
          type: 'image',
          filename: 'tweet_123_1',
        },
        {
          type: 'video',
          filename: 'tweet_123',
          tweetId: '123',
          needsVideoLookup: true,
        },
      ],
    }));
    chrome.downloads.download = vi.fn(async () => 96);
    chrome.downloads.search = async () => [{
      id: 96, state: 'complete', filename: '/downloads/tweet_123_1.jpg',
    }];

    const operation = orchestrateSubmittedDownload(
      'https://x.com/user/status/123',
      { operationTimeoutMs: 5, submittedFetch: neverFetch },
    );
    const settled = await settleWithin(operation);
    if (!settled) {
      releaseFetch?.({ ok: false, status: 503, json: async () => ({}) });
      await operation;
    }

    expect(settled?.result).toEqual({
      ok: false, code: 'download_failed', platform: 'twitter', count: 1,
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(95);
    expect(chrome.downloads.download).toHaveBeenCalledOnce();
  });

  it.each([
    'https://www.facebook.com/login/',
    'https://example.com/post/1',
    'https://x.com/user/status/123',
  ])('rejects an unavailable or cross-platform final tab URL: %s', async (finalUrl) => {
    chrome.tabs.create = vi.fn(async () => ({ id: 87, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({ id: 87, status: 'complete', url: finalUrl }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({ urls: [], platform: 'facebook' }));

    const result = await orchestrateSubmittedDownload(
      'https://www.facebook.com/share/p/AbC_def-123/',
    );

    expect(result).toEqual({
      ok: false, code: 'access_or_unavailable', platform: 'facebook', count: 0,
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).toHaveBeenCalledWith(87);
  });

  it('reports access or unavailable for an empty page without claiming an auth cause', async () => {
    chrome.tabs.create = vi.fn(async () => ({ id: 80, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 80,
      status: 'complete',
      url: 'https://www.facebook.com/example/posts/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({ urls: [], platform: 'facebook' }));

    const result = await orchestrateSubmittedDownload(
      'https://www.facebook.com/example/posts/123',
      { resolveAttempts: 2, retryDelayMs: 0 },
    );

    expect(result).toEqual({
      ok: false, code: 'access_or_unavailable', platform: 'facebook', count: 0,
    });
    expect(result.code).not.toBe('auth_required');
    expect(chrome.tabs.remove).toHaveBeenCalledWith(80);
  });

  it('reports resolution timeout when the content script never becomes available', async () => {
    chrome.tabs.create = vi.fn(async () => ({ id: 81, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 81, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => { throw new Error('no receiver'); });

    const result = await orchestrateSubmittedDownload(
      'https://x.com/user/status/123',
      { resolveAttempts: 2, retryDelayMs: 0 },
    );

    expect(result).toEqual({
      ok: false, code: 'resolution_timeout', platform: 'twitter', count: 0,
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(81);
  });

  it('times out a never-settling resolver message and closes its temporary tab', async () => {
    let releaseMessage;
    chrome.tabs.create = vi.fn(async () => ({ id: 91, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 91, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(() => new Promise((resolve) => {
      releaseMessage = resolve;
    }));

    const operation = orchestrateSubmittedDownload(
      'https://x.com/user/status/123',
      { operationTimeoutMs: 5, resolveAttempts: 1 },
    );
    const settled = await settleWithin(operation);
    releaseMessage?.({ urls: [], platform: 'twitter' });
    if (!settled) await operation;

    expect(settled?.result).toEqual({
      ok: false, code: 'resolution_timeout', platform: 'twitter', count: 0,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(91);
  });

  it('reports a partial download failure with only the successful count and closes the tab', async () => {
    chrome.tabs.create = vi.fn(async () => ({ id: 82, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 82,
      status: 'complete',
      url: 'https://www.facebook.com/example/posts/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'facebook',
      urls: [
        { url: 'https://scontent.xx.fbcdn.net/one.jpg', type: 'image', filename: 'one' },
        { url: 'https://scontent.xx.fbcdn.net/two.jpg', type: 'image', filename: 'two' },
      ],
    }));
    chrome.downloads.download = vi.fn()
      .mockResolvedValueOnce(71)
      .mockRejectedValueOnce(new Error('disk full'));
    chrome.downloads.search = async () => [{
      id: 71, state: 'complete', filename: '/downloads/one.jpg',
    }];

    const result = await orchestrateSubmittedDownload(
      'https://www.facebook.com/example/posts/123',
      { retryDelayMs: 0 },
    );

    expect(result).toEqual({
      ok: false, code: 'download_failed', platform: 'facebook', count: 1,
    });
    const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });
    expect(downloadHistory).toHaveLength(1);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(82);
  });

  it('reports a started download separately when history recording fails', async () => {
    const originalSet = chrome.storage.local.set;
    chrome.tabs.create = vi.fn(async () => ({ id: 84, status: 'complete' }));
    chrome.tabs.get = vi.fn(async () => ({
      id: 84, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'twitter',
      urls: [{ url: 'https://pbs.twimg.com/media/one.jpg', type: 'image', filename: 'one' }],
    }));
    chrome.downloads.download = vi.fn(async () => 85);
    chrome.downloads.search = async () => [{
      id: 85, state: 'complete', filename: '/downloads/one.jpg',
    }];
    chrome.storage.local.set = vi.fn(async () => { throw new Error('storage unavailable'); });

    try {
      const result = await orchestrateSubmittedDownload('https://x.com/user/status/123');
      expect(result).toEqual({
        ok: false, code: 'history_failed', platform: 'twitter', count: 1,
      });
      expect(chrome.tabs.remove).toHaveBeenCalledWith(84);
    } finally {
      chrome.storage.local.set = originalSet;
    }
  });

  it('rejects a concurrent valid job with busy', async () => {
    let releaseCreate;
    chrome.tabs.create = vi.fn(() => new Promise((resolve) => { releaseCreate = resolve; }));
    chrome.tabs.get = vi.fn(async (id) => ({
      id, status: 'complete', url: 'https://x.com/user/status/123',
    }));
    chrome.tabs.remove = vi.fn();
    chrome.tabs.sendMessage = vi.fn(async () => ({
      platform: 'twitter',
      urls: [{ url: 'https://pbs.twimg.com/media/one.jpg', type: 'image', filename: 'one' }],
    }));
    chrome.downloads.download = vi.fn(async () => 91);
    chrome.downloads.search = async () => [{
      id: 91, state: 'complete', filename: '/downloads/one.jpg',
    }];

    const first = sendExternal({
      action: 'downloadSubmittedUrl',
      url: 'https://x.com/user/status/123',
    });
    await Promise.resolve();
    const second = await sendExternal({
      action: 'downloadSubmittedUrl',
      url: 'https://x.com/user/status/456',
    });

    expect(second).toEqual({ ok: false, code: 'busy', platform: 'twitter', count: 0 });
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
    releaseCreate({ id: 83, status: 'complete' });
    await expect(first).resolves.toEqual({ ok: true, code: 'ok', platform: 'twitter', count: 1 });
  });
});
