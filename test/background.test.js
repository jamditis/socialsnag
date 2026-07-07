import { describe, it, expect, afterEach } from 'vitest';
import {
  detectPlatform,
  guessExtension,
  validateDownloadUrl,
  sanitizeDownloadPath,
  resolveInstagramPost,
  resolveInstagramStories,
} from '../src/background.js';

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

    const items = await resolveInstagramPost('ABC');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.url)).toEqual([
      'https://cdn.cdninstagram.com/1.jpg',
      'https://cdn.cdninstagram.com/2.mp4',
      'https://cdn.cdninstagram.com/3.jpg',
    ]);
    expect(items.map((i) => i.type)).toEqual(['image', 'video', 'image']);
    expect(items.map((i) => i.filename)).toEqual(['post_ABC_1', 'post_ABC_2', 'post_ABC_3']);
  });

  it('returns null when the API rate-limits (429)', async () => {
    installFetch(() => ({ status: 429, json: {} }));
    const items = await resolveInstagramPost('ABC');
    expect(items).toBeNull();
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

    const items = await resolveInstagramStories({ username: 'x', storyId: null });
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

    const items = await resolveInstagramStories({ username: 'x', storyId: '2' });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://cdn.cdninstagram.com/2.jpg');
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
