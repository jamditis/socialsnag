import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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
  // revokeBlobWhenComplete registers a downloads.onChanged listener per zip.
  // Clear them so _listeners[0] is deterministic and listeners don't leak.
  beforeEach(() => { globalThis.chrome.downloads.onChanged._listeners.length = 0; });
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
      globalThis.chrome.downloads.onChanged._listeners[0]({ id: 42, state: { current: 'complete' } });
      await Promise.resolve();
      expect(off.sent).toContainEqual({ target: 'offscreen', action: 'revoke', url: 'blob:zip1' });
    } finally {
      globalThis.chrome.downloads.download = origDownload;
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

  it('revokes the blob on an interrupted download too', async () => {
    const off = installOffscreenMock(true);
    const origDownload = globalThis.chrome.downloads.download;
    globalThis.chrome.downloads.download = async () => 63;

    try {
      const result = await downloadItemsAsZip(imgItems, 'bluesky');
      expect(result).toBe(2);

      globalThis.chrome.downloads.onChanged._listeners[0]({ id: 63, state: { current: 'interrupted' } });
      await Promise.resolve();
      expect(off.sent).toContainEqual({ target: 'offscreen', action: 'revoke', url: 'blob:zip1' });
    } finally {
      globalThis.chrome.downloads.download = origDownload;
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
});
