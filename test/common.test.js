import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DOMAINS,
  isAllowedDomain,
  hostMatches,
  isHttps,
  sanitizeFilename,
  extractId,
  TEMPLATE_TOKENS,
  ALWAYS_PRESENT_TOKENS,
  renderTemplate,
  validateTemplate,
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

describe('hostMatches', () => {
  it('matches an exact host', () => {
    expect(hostMatches('https://media.licdn.com/x.jpg', 'media.licdn.com')).toBe(true);
  });

  it('matches a subdomain of the host', () => {
    expect(hostMatches('https://static.media.licdn.com/x.png', 'media.licdn.com')).toBe(true);
    expect(hostMatches('https://scontent.xx.fbcdn.net/v/photo.jpg', 'fbcdn.net')).toBe(true);
  });

  it('rejects a host where the domain appears only in the path or query', () => {
    expect(hostMatches('https://evil.com/?u=media.licdn.com/x.jpg', 'media.licdn.com')).toBe(false);
    expect(hostMatches('https://evil.com/fbcdn.net/photo.jpg', 'fbcdn.net')).toBe(false);
  });

  it('rejects a dot-boundary lookalike host', () => {
    expect(hostMatches('https://evilfbcdn.net/photo.jpg', 'fbcdn.net')).toBe(false);
    expect(hostMatches('https://media.licdn.com.evil.com/x.jpg', 'media.licdn.com')).toBe(false);
  });

  it('returns false for malformed URLs and empty input', () => {
    expect(hostMatches('not a url', 'fbcdn.net')).toBe(false);
    expect(hostMatches('', 'fbcdn.net')).toBe(false);
    expect(hostMatches(null, 'fbcdn.net')).toBe(false);
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

describe('renderTemplate', () => {
  const FULL = {
    platform: 'facebook',
    type: 'image',
    postId: '123456',
    username: 'someone',
    index: 2,
    date: '2026-07-20',
  };

  it('substitutes every token', () => {
    expect(renderTemplate('{platform}_{type}_{postId}_{username}_{index}_{date}', FULL))
      .toBe('facebook_image_123456_someone_2_2026-07-20');
  });

  it('coerces a numeric field rather than dropping it', () => {
    // index arrives as a number from the resolvers, and 0 is a real value.
    expect(renderTemplate('photo_{index}', { index: 0 })).toBe('photo_0');
    expect(renderTemplate('photo_{index}', { index: 7 })).toBe('photo_7');
  });

  // The separator handling is the whole reason this is a tokenizer rather than a
  // string replace, so it gets pinned from every direction.
  describe('a missing token takes its separator, and only its separator', () => {
    it('drops a leading token cleanly', () => {
      expect(renderTemplate('{username}_{index}', { index: 1 })).toBe('1');
    });

    it('drops a trailing token cleanly', () => {
      expect(renderTemplate('{platform}_{postId}', { platform: 'facebook' })).toBe('facebook');
    });

    it('closes the gap when a middle token is missing', () => {
      expect(renderTemplate('{platform}_{postId}_{index}', { platform: 'facebook', index: 3 }))
        .toBe('facebook_3');
    });

    it('handles several missing in a row', () => {
      expect(renderTemplate('{platform}_{username}_{postId}_{index}', { platform: 'facebook' }))
        .toBe('facebook');
    });

    it('leaves a separator the user doubled on purpose', () => {
      expect(renderTemplate('photo__{index}', { index: 1 })).toBe('photo__1');
    });

    it('does not eat a literal that is not a separator', () => {
      expect(renderTemplate('{username}post_{index}', { index: 1 })).toBe('post_1');
    });

    it('treats an empty string and null like a missing field', () => {
      expect(renderTemplate('{platform}_{postId}', { platform: 'facebook', postId: '' }))
        .toBe('facebook');
      expect(renderTemplate('{platform}_{postId}', { platform: 'facebook', postId: null }))
        .toBe('facebook');
    });
  });

  it('keeps folder separators and trims each segment on its own', () => {
    expect(renderTemplate('{platform}/{username}/post_{index}', { platform: 'facebook', index: 1 }))
      .toBe('facebook//post_1');
  });

  it('renders an unknown token as nothing rather than leaking the braces', () => {
    // validateTemplate rejects these before they can be saved; this is the
    // belt-and-braces behaviour for a value that reached the renderer anyway.
    expect(renderTemplate('photo_{nope}', {})).toBe('photo');
  });

  it('returns an empty string for a non-string template', () => {
    expect(renderTemplate(undefined, FULL)).toBe('');
    expect(renderTemplate(null, FULL)).toBe('');
  });
});

describe('validateTemplate', () => {
  it('accepts the shipped defaults', () => {
    expect(validateTemplate('photo_{postId}_{index}').valid).toBe(true);
    expect(validateTemplate('SocialSnag/{platform}', { allowSlash: true }).valid).toBe(true);
  });

  it('rejects an empty or blank template', () => {
    expect(validateTemplate('').valid).toBe(false);
    expect(validateTemplate('   ').valid).toBe(false);
    expect(validateTemplate(undefined).valid).toBe(false);
  });

  it('rejects an unknown token and names it', () => {
    const result = validateTemplate('photo_{postid}');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('{postid}');
    // The likeliest cause of a near-miss is capitalisation, so say so.
    expect(result.reason).toContain('case-sensitive');
  });

  it('lists each unknown token once', () => {
    const result = validateTemplate('{nope}_{nope}_{alsonope}');
    expect(result.reason).toContain('{nope}');
    expect(result.reason).toContain('{alsonope}');
    expect(result.reason.match(/\{nope\}/g)).toHaveLength(1);
  });

  it('rejects a path separator in a filename but allows it in a folder', () => {
    expect(validateTemplate('{platform}/{postId}').valid).toBe(false);
    expect(validateTemplate('{platform}\\{postId}').valid).toBe(false);
    expect(validateTemplate('{platform}/{postId}', { allowSlash: true }).valid).toBe(true);
  });

  it('points at the folder setting rather than just saying no', () => {
    expect(validateTemplate('{platform}/{postId}').reason).toContain('folder setting');
  });

  it('rejects a template that can render to nothing', () => {
    // Neither token is guaranteed: a single photo from a post with an unreadable id
    // supplies neither, and the file would be named for its extension alone.
    const result = validateTemplate('{postId}_{index}');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('{platform}');
  });

  it('accepts an all-token template when one token is always present', () => {
    expect(validateTemplate('{platform}_{postId}').valid).toBe(true);
    expect(validateTemplate('{type}_{index}').valid).toBe(true);
  });

  // The guarantee the validator rests on: these are the tokens the caller always
  // supplies. If one is ever moved out of the always-present list without updating
  // the caller, this pairing is where it shows up.
  it('keeps the always-present tokens inside the vocabulary', () => {
    for (const token of ALWAYS_PRESENT_TOKENS) {
      expect(TEMPLATE_TOKENS).toContain(token);
    }
  });
});
