import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DOMAINS,
  isAllowedDomain,
  isHttps,
  sanitizeFilename,
  extractId,
  findNearestMedia,
} from '../src/platforms/common.js';

describe('ALLOWED_DOMAINS', () => {
  it('contains 6 expected CDN domains', () => {
    expect(ALLOWED_DOMAINS).toHaveLength(6);
    expect(ALLOWED_DOMAINS).toContain('cdninstagram.com');
    expect(ALLOWED_DOMAINS).toContain('pbs.twimg.com');
    expect(ALLOWED_DOMAINS).toContain('video.twimg.com');
    expect(ALLOWED_DOMAINS).toContain('fbcdn.net');
    expect(ALLOWED_DOMAINS).toContain('cdn.bsky.app');
    expect(ALLOWED_DOMAINS).toContain('video.bsky.app');
  });
});

describe('isAllowedDomain', () => {
  it('accepts exact CDN domains', () => {
    expect(isAllowedDomain('https://cdninstagram.com/image.jpg')).toBe(true);
    expect(isAllowedDomain('https://pbs.twimg.com/media/photo.jpg')).toBe(true);
    expect(isAllowedDomain('https://video.twimg.com/vid.mp4')).toBe(true);
    expect(isAllowedDomain('https://fbcdn.net/photo.jpg')).toBe(true);
  });

  it('accepts subdomains of allowed domains', () => {
    expect(isAllowedDomain('https://scontent.cdninstagram.com/image.jpg')).toBe(true);
    expect(isAllowedDomain('https://scontent-lax3-1.cdninstagram.com/photo.jpg')).toBe(true);
    expect(isAllowedDomain('https://video-sea1-1.fbcdn.net/video.mp4')).toBe(true);
  });

  it('rejects dot-boundary attack (evilcdninstagram.com)', () => {
    expect(isAllowedDomain('https://evilcdninstagram.com/image.jpg')).toBe(false);
  });

  it('rejects unrelated domains', () => {
    expect(isAllowedDomain('https://evil.com/image.jpg')).toBe(false);
    expect(isAllowedDomain('https://example.com/image.jpg')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isAllowedDomain('not a url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAllowedDomain('')).toBe(false);
  });
});

describe('isHttps', () => {
  it('accepts https URLs', () => {
    expect(isHttps('https://example.com/file.jpg')).toBe(true);
  });

  it('rejects http URLs', () => {
    expect(isHttps('http://example.com/file.jpg')).toBe(false);
  });

  it('rejects ftp URLs', () => {
    expect(isHttps('ftp://example.com/file.jpg')).toBe(false);
  });

  it('returns false for garbage input', () => {
    expect(isHttps('not a url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHttps('')).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('strips path traversal sequences (../)', () => {
    // ../ is removed first, then / is replaced with _ by the special char filter
    expect(sanitizeFilename('../../../etc/passwd')).toBe('etc_passwd');
  });

  it('strips backslash path traversal (..\\)', () => {
    // ..\\ is removed first, then remaining chars are sanitized
    expect(sanitizeFilename('..\\..\\secret')).toBe('secret');
  });

  it('replaces special characters', () => {
    const result = sanitizeFilename('file<>:"/\\|?*name');
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('replaces control characters', () => {
    const result = sanitizeFilename('file\x00\x01\x1fname');
    expect(result).not.toMatch(/[\x00-\x1f]/);
  });

  it('returns null for null input', () => {
    expect(sanitizeFilename(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeFilename('')).toBeNull();
  });

  it('passes through clean filenames unchanged', () => {
    expect(sanitizeFilename('photo_12345')).toBe('photo_12345');
  });
});

describe('extractId', () => {
  it('returns first capture group on regex match', () => {
    expect(extractId('/p/ABC123/', /\/(p|reel|tv)\/([A-Za-z0-9_-]+)/)).toBe('p');
  });

  it('returns captured ID from a URL pattern', () => {
    const pattern = /\/status\/(\d+)/;
    expect(extractId('/user/status/123456789', pattern)).toBe('123456789');
  });

  it('returns null when no match', () => {
    expect(extractId('/about', /\/status\/(\d+)/)).toBeNull();
  });
});

describe('findNearestMedia', () => {
  it('returns null for null input', () => {
    expect(findNearestMedia(null)).toBeNull();
  });

  it('returns the element itself if it is an IMG', () => {
    const img = { tagName: 'IMG' };
    expect(findNearestMedia(img)).toBe(img);
  });

  it('returns the element itself if it is a VIDEO', () => {
    const video = { tagName: 'VIDEO' };
    expect(findNearestMedia(video)).toBe(video);
  });

  it('finds an img child inside a container', () => {
    const img = { tagName: 'IMG' };
    const div = {
      tagName: 'DIV',
      querySelector: (sel) => (sel === 'img' ? img : null),
    };
    expect(findNearestMedia(div)).toBe(img);
  });

  it('finds a video child when no img child exists', () => {
    const video = { tagName: 'VIDEO' };
    const div = {
      tagName: 'DIV',
      querySelector: (sel) => (sel === 'video' ? video : null),
    };
    expect(findNearestMedia(div)).toBe(video);
  });
});
