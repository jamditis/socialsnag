import { describe, it, expect } from 'vitest';
import {
  ALLOWED_DOMAINS,
  isAllowedDomain,
  hostMatches,
  isHttps,
  sanitizeFilename,
  withItemMeta,
  extractId,
  TEMPLATE_TOKENS,
  ALWAYS_PRESENT_TOKENS,
  FOLDER_TOKENS,
  renderTemplate,
  validateTemplate,
  templateFieldError,
  findNearestMedia,
  platformLabel,
  classifyFailure,
} from '../src/platforms/common.js';

describe('withItemMeta', () => {
  it('adds only present values as strings and preserves the item fields', () => {
    const item = { url: 'https://example.test/media.jpg', filename: 'original_name' };

    expect(withItemMeta(item, { postId: 123, username: 'someone' })).toEqual({
      ...item,
      meta: { postId: '123', username: 'someone' },
    });
  });

  it('omits meta when no verified value is available', () => {
    const item = { filename: null };
    expect(withItemMeta(item, { postId: '', username: null })).toBe(item);
    expect(withItemMeta(item, null)).toBe(item);
  });
});

describe('ALLOWED_DOMAINS', () => {
  it('contains 7 expected CDN domains', () => {
    expect(ALLOWED_DOMAINS).toHaveLength(7);
    expect(ALLOWED_DOMAINS).toContain('cdninstagram.com');
    expect(ALLOWED_DOMAINS).toContain('pbs.twimg.com');
    expect(ALLOWED_DOMAINS).toContain('video.twimg.com');
    expect(ALLOWED_DOMAINS).toContain('fbcdn.net');
    expect(ALLOWED_DOMAINS).toContain('cdn.bsky.app');
    expect(ALLOWED_DOMAINS).toContain('video.bsky.app');
    expect(ALLOWED_DOMAINS).toContain('media.licdn.com');
  });

  it('admits the LinkedIn CDN the resolver actually produces', () => {
    // upgradeUrl() in platforms/linkedin.js only ever returns media.licdn.com
    // URLs, so the allowlist and the resolver have to agree or every LinkedIn
    // download is rejected after the user has already granted site access.
    expect(isAllowedDomain('https://media.licdn.com/dms/image/v2/abc/feedshare.jpg')).toBe(true);
  });

  it('does not admit other licdn subdomains', () => {
    expect(isAllowedDomain('https://static.licdn.com/tracker.gif')).toBe(false);
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

    // The gap is the same gap whether the separator is the whole literal or just
    // starts it, and the trim at the end only reaches the ends of a segment, so a
    // doubled separator stranded mid-name would survive to the filename.
    it('takes a separator that leads a literal, not only one that is the literal', () => {
      expect(renderTemplate('post_{username}_photo', { })).toBe('post_photo');
      expect(renderTemplate('post_{username}_photo', { username: 'bob' })).toBe('post_bob_photo');
    });

    it('takes the whole separator run in front of a literal', () => {
      expect(renderTemplate('{username}__photo', { })).toBe('photo');
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
    // Neither token is guaranteed: a photo from a post with an unreadable id on a
    // platform that hides the handle supplies neither, and the file would be named
    // for its extension alone.
    const result = validateTemplate('{postId}_{username}');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('{platform}');
  });

  it('accepts an all-token template when one token is always present', () => {
    expect(validateTemplate('{platform}_{postId}').valid).toBe(true);
    expect(validateTemplate('{type}_{index}').valid).toBe(true);
  });

  // Both download paths pass a position, so numbering an album is a template the
  // user is entitled to write. Rejecting it told them a working template was broken.
  it('accepts a template numbered only by index', () => {
    expect(validateTemplate('{index}').valid).toBe(true);
    expect(validateTemplate('{postId}_{index}').valid).toBe(true);
  });

  it('rejects an unmatched brace instead of saving it as fixed text', () => {
    const result = validateTemplate('photo_{postId');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('{');
    expect(validateTemplate('photo_postId}').valid).toBe(false);
    expect(validateTemplate('photo_{postId}').valid).toBe(true);
  });

  // The guarantee the validator rests on: these are the tokens the caller always
  // supplies. If one is ever moved out of the always-present list without updating
  // the caller, this pairing is where it shows up.
  it('keeps the always-present tokens inside the vocabulary', () => {
    for (const token of ALWAYS_PRESENT_TOKENS) {
      expect(TEMPLATE_TOKENS).toContain(token);
    }
  });

  // The folder renders {platform} only; validating it against the full vocabulary
  // would accept {date} or {username} and then write a literal `{date}` folder to
  // disk. allowedTokens restricts the folder to the tokens it can actually expand.
  it('restricts a template to allowedTokens when given', () => {
    const opts = { allowSlash: true, allowedTokens: FOLDER_TOKENS };
    expect(validateTemplate('SocialSnag/{platform}', opts).valid).toBe(true);
    const rejected = validateTemplate('shots/{date}', opts);
    expect(rejected.valid).toBe(false);
    expect(rejected.reason).toContain('{date}');
    // A token outside the subset is named "unknown" against the subset, so the
    // reason lists {platform} as what is available here, not the whole vocabulary.
    expect(rejected.reason).toContain('{platform}');
    expect(rejected.reason).not.toContain('{username}');
  });

  // FOLDER_TOKENS is a subset of the vocabulary. If the folder is later widened to
  // the full set, this stays true; a token invented for the folder alone would not.
  it('keeps FOLDER_TOKENS inside the vocabulary', () => {
    for (const token of FOLDER_TOKENS) {
      expect(TEMPLATE_TOKENS).toContain(token);
    }
  });
});

describe('templateFieldError', () => {
  // Empty is the opt-out for both option fields: the filename keeps each
  // platform's own name, the folder falls back to its default. validateTemplate
  // rejects empty on purpose, so this is the gate the options page asks instead.
  it('treats an empty or blank value as acceptable', () => {
    expect(templateFieldError('')).toBe(null);
    expect(templateFieldError('   ')).toBe(null);
    expect(templateFieldError(undefined)).toBe(null);
  });

  it('accepts a valid template, forwarding the folder allowSlash option', () => {
    expect(templateFieldError('{platform}_{postId}_{index}')).toBe(null);
    expect(templateFieldError('shots/{platform}', { allowSlash: true })).toBe(null);
  });

  it('returns the validator reason for an invalid template', () => {
    expect(templateFieldError('{postid}')).toContain('Unknown token');
    // A slash is a filename error but a valid folder, so the option decides.
    expect(templateFieldError('{platform}/{postId}')).toContain('cannot contain');
    expect(templateFieldError('{platform}/{postId}', { allowSlash: true })).toBe(null);
  });

  // The options page passes the folder's allowedTokens through this wrapper, so the
  // subset restriction has to survive the forwarding, not just the direct call.
  it('forwards allowedTokens so the folder rejects a token it cannot render', () => {
    const opts = { allowSlash: true, allowedTokens: FOLDER_TOKENS };
    expect(templateFieldError('SocialSnag/{platform}', opts)).toBe(null);
    expect(templateFieldError('{username}/{platform}', opts)).toContain('{username}');
  });
});

describe('platformLabel', () => {
  it('uses the picker label for a known platform', () => {
    expect(platformLabel('instagram')).toBe('Instagram');
    expect(platformLabel('twitter')).toBe('Twitter/X');
  });

  it('falls back to a neutral label rather than leaking the id', () => {
    expect(platformLabel('mastodon')).toBe('this site');
    expect(platformLabel(undefined)).toBe('this site');
  });
});

describe('classifyFailure', () => {
  const msg = (args) => classifyFailure(args).message;

  it('names the platform in the message', () => {
    expect(msg({ platform: 'twitter', outcome: { kind: 'http', status: 429 } }))
      .toBe('Twitter/X is rate-limiting downloads. Try again in a minute.');
  });

  // The retry verdict is the point of the classifier: a caller must be able to
  // tell "try again" from "give up" without re-reading the message text.
  it('marks any 5xx transient', () => {
    for (const status of [500, 502, 503]) {
      const r = classifyFailure({ platform: 'instagram', outcome: { kind: 'http', status } });
      expect(r.retry).toBe('transient');
      expect(r.message).toMatch(/network problem/i);
    }
  });

  // Instagram's resolvers pass status 0 for "HTTP 200 but parsed to no items"
  // (background.js) — an aged-out story or empty post, not a transport failure.
  // It must stay a terminal generic message: a "network, try again" prompt would
  // send the user to retry a request that will keep returning empty.
  it('treats status 0 as an empty result, not a transient network error', () => {
    const r = classifyFailure({ platform: 'instagram', outcome: { kind: 'http', status: 0 } });
    expect(r.retry).toBe('terminal');
    expect(r.message).toBe('Instagram did not return this media. Try refreshing the page.');
  });

  it('marks rate-limiting transient but a 404 terminal', () => {
    expect(classifyFailure({ platform: 'instagram', outcome: { kind: 'http', status: 429 } }).retry)
      .toBe('transient');
    const notFound = classifyFailure({ platform: 'instagram', outcome: { kind: 'http', status: 404 } });
    expect(notFound.retry).toBe('terminal');
    // Names the platform like every sibling branch does — the original Instagram
    // mapper said "This Instagram media...", and dropping the label on extraction
    // would be a silent inconsistency a loose /not found/ regex misses.
    expect(notFound.message).toBe('This Instagram media has expired or was not found.');
  });

  // A 401/403 is the one status whose meaning depends on the phase: not-logged-in
  // at the resolver, but an expired signed URL once we already hold one.
  it('reads a 401/403 by phase', () => {
    expect(msg({ platform: 'instagram', phase: 'resolve', outcome: { kind: 'http', status: 401 } }))
      .toBe('Log in to Instagram to download this.');
    expect(msg({ platform: 'instagram', phase: 'download', outcome: { kind: 'http', status: 403 } }))
      .toMatch(/link expired/i);
    // resolve is the default when no phase is given.
    expect(msg({ platform: 'instagram', outcome: { kind: 'http', status: 401 } }))
      .toMatch(/log in/i);
  });

  it('handles non-HTTP reasons without inventing a status message', () => {
    expect(msg({ platform: 'bluesky', outcome: { kind: 'reason', reason: 'login-required' } }))
      .toBe('Log in to Bluesky to download this.');
    expect(msg({ platform: 'bluesky', outcome: { kind: 'reason', reason: 'no-media' } }))
      .toMatch(/could not find downloadable media/i);
  });

  it('falls back to a usable message for an unknown status or missing outcome', () => {
    expect(msg({ platform: 'instagram', outcome: { kind: 'http', status: 418 } }))
      .toBe('Instagram did not return this media. Try refreshing the page.');
    expect(msg({ platform: 'instagram' })).toMatch(/did not return this media/i);
    expect(msg({})).toMatch(/this site/i);
  });
});
