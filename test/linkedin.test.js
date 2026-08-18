import { describe, it, expect } from 'vitest';
import { upgradeUrl, extractPostId, buildImageItems } from '../src/platforms/linkedin.js';

describe('upgradeUrl', () => {
  it('returns null for null input', () => {
    expect(upgradeUrl(null)).toBeNull();
  });

  it('returns null for a non-licdn URL', () => {
    expect(upgradeUrl('https://example.com/photo.jpg')).toBeNull();
  });

  it('returns null when media.licdn.com appears only in the query, not the host', () => {
    expect(upgradeUrl('https://evil.com/?u=https://media.licdn.com/x.jpg')).toBeNull();
  });

  it('returns null for a dot-boundary lookalike host', () => {
    expect(upgradeUrl('https://media.licdn.com.attacker.com/x.jpg')).toBeNull();
  });

  it('drops a /shrink_<w>_<h>/ size segment to get the full-size original', () => {
    const url = 'https://media.licdn.com/dms/image/v2/D4E22/shrink_800_800/photo.jpg';
    const result = upgradeUrl(url);
    expect(result).toBe('https://media.licdn.com/dms/image/v2/D4E22/photo.jpg');
    expect(result).not.toContain('shrink_');
  });

  it('returns the URL unchanged when there is no shrink segment', () => {
    const url = 'https://media.licdn.com/dms/image/v2/D4E22/photo.jpg';
    expect(upgradeUrl(url)).toBe(url);
  });

  it('handles asymmetric width/height in the shrink segment', () => {
    const url = 'https://media.licdn.com/dms/image/shrink_1280_720/clip.jpg';
    expect(upgradeUrl(url)).toBe('https://media.licdn.com/dms/image/clip.jpg');
  });

  it('matches the licdn host regardless of subdomain prefix', () => {
    const url = 'https://static.media.licdn.com/shrink_200_200/x.png';
    expect(upgradeUrl(url)).toBe('https://static.media.licdn.com/x.png');
  });
});

describe('extractPostId', () => {
  it('returns null for empty or null input', () => {
    expect(extractPostId('')).toBeNull();
    expect(extractPostId(null)).toBeNull();
  });

  it('extracts the id from an activity-<n> post permalink', () => {
    const href = 'https://www.linkedin.com/posts/jane-doe_some-slug-activity-7012345678901234567-abCd/';
    expect(extractPostId(href)).toBe('7012345678901234567');
  });

  it('extracts the id from a urn:li:activity:<n> feed update', () => {
    const href = 'https://www.linkedin.com/feed/update/urn:li:activity:7099999999999999999';
    expect(extractPostId(href)).toBe('7099999999999999999');
  });

  it('returns null when no activity id is present', () => {
    expect(extractPostId('https://www.linkedin.com/in/jane-doe/')).toBeNull();
  });

  it('prefers the activity-<n> permalink form when both could match', () => {
    // The activity-(\d+) pattern is tried before the urn form.
    expect(extractPostId('activity-111 urn:li:activity:222')).toBe('111');
  });
});

describe('buildImageItems', () => {
  const CDN = 'https://media.licdn.com/dms/image/v2/D4E22';
  // width is what the card renders, naturalWidth what the file actually is. They
  // differ on LinkedIn, and the difference is the whole reason size alone cannot
  // separate a post photo from the chrome around it.
  const img = (src, width, naturalWidth = width) => ({ src, width, naturalWidth });

  it('keeps the post photos in document order', () => {
    const { items } = buildImageItems([
      img(`${CDN}/shrink_800_800/first.jpg`, 500, 800),
      img(`${CDN}/second.jpg`, 500, 800),
    ]);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/first.jpg`, `${CDN}/second.jpg`]);
  });

  it('skips the author avatar and company logo by rendition name', () => {
    // A feed card serves both from media.licdn.com, inside the post container, at
    // 100x100 intrinsic. Rendered small, stored well over any size threshold that
    // would still keep a real photo, so only the name in the path separates them.
    const { items } = buildImageItems([
      img(`${CDN}/profile-displayphoto-shrink_100_100/avatar.jpg`, 48, 100),
      img(`${CDN}/company-logo_100_100/logo.png`, 32, 100),
      img(`${CDN}/shrink_800_800/photo.jpg`, 500, 800),
    ]);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/photo.jpg`]);
  });

  it('numbers the post photo first when chrome precedes it in the card', () => {
    // The avatar leads the card in document order. Counting it would take `_1` and
    // push the photo the user right-clicked to `_2`.
    const { items } = buildImageItems([
      img(`${CDN}/profile-displayphoto-shrink_100_100/avatar.jpg`, 48, 100),
      img(`${CDN}/shrink_800_800/photo.jpg`, 500, 800),
    ], '7012345678901234567');
    expect(items).toEqual([{
      url: `${CDN}/photo.jpg`,
      type: 'image',
      filename: 'post_7012345678901234567_1',
      meta: { postId: '7012345678901234567' },
    }]);
  });

  it('still drops an icon that is small in the file, not just on the page', () => {
    // A reaction icon is stored at the size it renders, so size is what catches it.
    const { items } = buildImageItems([
      img(`${CDN}/reactions/like.png`, 16, 16),
      img(`${CDN}/shrink_800_800/photo.jpg`, 500, 800),
    ]);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/photo.jpg`]);
  });

  it('keeps an image that has not laid out yet', () => {
    // Below-the-fold images report width 0; dropping them would lose real photos.
    const { items } = buildImageItems([{ src: `${CDN}/shrink_800_800/photo.jpg`, width: 0 }]);
    expect(items).toHaveLength(1);
  });

  it('counts two renditions of one photo once', () => {
    // upgradeUrl normalizes the shrink segment away, so both srcs name one photo.
    const { items } = buildImageItems([
      img(`${CDN}/shrink_400_400/photo.jpg`, 200),
      img(`${CDN}/shrink_800_800/photo.jpg`, 500),
    ], '7012345678901234567');
    expect(items).toEqual([{
      url: `${CDN}/photo.jpg`,
      type: 'image',
      filename: 'post_7012345678901234567_1',
      meta: { postId: '7012345678901234567' },
    }]);
  });

  it('numbers from the post id when the page URL carries one', () => {
    const { items, index } = buildImageItems([
      img(`${CDN}/a.jpg`, 500),
      img(`${CDN}/b.jpg`, 500),
    ], '7099999999999999999');
    expect(items.map((i) => i.filename)).toEqual([
      'post_7099999999999999999_1',
      'post_7099999999999999999_2',
    ]);
    // The video sweep continues the numbering from here.
    expect(index).toBe(3);
  });

  it('leaves the filename null when the page URL has no post id', () => {
    const { items } = buildImageItems([img(`${CDN}/a.jpg`, 500)]);
    expect(items[0].filename).toBeNull();
    expect(items[0].meta).toBeUndefined();
  });

  it('adds a verified card id without changing the existing filename', () => {
    const { items } = buildImageItems(
      [img(`${CDN}/a.jpg`, 500)],
      null,
      '7099999999999999999',
    );
    expect(items[0].filename).toBeNull();
    expect(items[0].meta).toEqual({ postId: '7099999999999999999' });
  });

  it('ignores images from outside the LinkedIn CDN', () => {
    const { items } = buildImageItems([img('https://example.com/photo.jpg', 500)]);
    expect(items).toEqual([]);
  });
});
