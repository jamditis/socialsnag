import { describe, it, expect, afterEach } from 'vitest';
import {
  detectPlatform,
  guessExtension,
  validateDownloadUrl,
  sanitizeDownloadPath,
  resolveInstagramPost,
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
