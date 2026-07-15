import { describe, it, expect } from 'vitest';
import { shortcodeToMediaId, pickBestCandidate, pickBestVideo, selectByQuality } from '../src/platforms/instagram-api.js';

describe('shortcodeToMediaId', () => {
  it('converts a known shortcode to its media id', () => {
    // Cd_ -> deterministic base64url integer
    expect(shortcodeToMediaId('B')).toBe('1');
    expect(shortcodeToMediaId('BA')).toBe('64');
  });
  it('returns null for empty or invalid input', () => {
    expect(shortcodeToMediaId('')).toBeNull();
    expect(shortcodeToMediaId(null)).toBeNull();
    expect(shortcodeToMediaId('has space')).toBeNull();
    expect(shortcodeToMediaId('bad*char')).toBeNull();
  });
});

describe('pickBestCandidate', () => {
  it('returns the largest by area', () => {
    const candidates = [
      { url: 'small', width: 320, height: 320 },
      { url: 'big', width: 1080, height: 1080 },
      { url: 'med', width: 640, height: 640 },
    ];
    expect(pickBestCandidate(candidates)).toBe('big');
  });
  it('returns null for empty/missing', () => {
    expect(pickBestCandidate([])).toBeNull();
    expect(pickBestCandidate(undefined)).toBeNull();
  });
});

describe('pickBestVideo', () => {
  it('returns the widest video version url', () => {
    const versions = [
      { url: 'v480', width: 480 },
      { url: 'v1080', width: 1080 },
    ];
    expect(pickBestVideo(versions)).toBe('v1080');
  });
  it('returns null when none have urls', () => {
    expect(pickBestVideo([{ width: 100 }])).toBeNull();
  });
});

// The quality-selection core behind the resolution picker (#19). The default
// 'largest' path is the historical behavior the pickBest* wrappers already cover
// above; these lock in the resolution-cap path they now delegate to.
describe('selectByQuality', () => {
  const byWidth = (c) => c.width || 0;
  const items = [
    { url: 'w480', width: 480 },
    { url: 'w1080', width: 1080 },
    { url: 'w1440', width: 1440 },
  ];

  it('takes the largest by the size metric by default', () => {
    expect(selectByQuality(items, byWidth)).toBe('w1440');
    expect(selectByQuality(items, byWidth, 'largest')).toBe('w1440');
  });

  it('caps at maxWidth, choosing the largest candidate no wider than the cap', () => {
    expect(selectByQuality(items, byWidth, { maxWidth: 1080 })).toBe('w1080');
    expect(selectByQuality(items, byWidth, { maxWidth: 1200 })).toBe('w1080');
    expect(selectByQuality(items, byWidth, { maxWidth: 2000 })).toBe('w1440');
  });

  it('falls back to the narrowest when every candidate is wider than the cap', () => {
    expect(selectByQuality(items, byWidth, { maxWidth: 240 })).toBe('w480');
  });

  it('ignores a non-numeric maxWidth and stays on the largest', () => {
    expect(selectByQuality(items, byWidth, { maxWidth: 'big' })).toBe('w1440');
  });

  it('returns null for an empty, url-less, or non-array input', () => {
    expect(selectByQuality([], byWidth)).toBeNull();
    expect(selectByQuality([{ width: 100 }], byWidth)).toBeNull();
    expect(selectByQuality(undefined, byWidth)).toBeNull();
  });
});

describe('pickBest* honor a resolution cap', () => {
  it('pickBestCandidate caps by width but still ranks the pool by area', () => {
    const candidates = [
      { url: 'tall1080', width: 1080, height: 1350 },
      { url: 'square1080', width: 1080, height: 1080 },
      { url: 'huge', width: 2048, height: 2048 },
    ];
    // Cap keeps both 1080-wide candidates; area then prefers the taller one.
    expect(pickBestCandidate(candidates, { maxWidth: 1080 })).toBe('tall1080');
  });
  it('pickBestVideo caps by width', () => {
    const versions = [
      { url: 'v480', width: 480 },
      { url: 'v1080', width: 1080 },
    ];
    expect(pickBestVideo(versions, { maxWidth: 720 })).toBe('v480');
  });
  it('falls back to the narrowest by width when all images exceed the cap, not the smallest area', () => {
    // Both exceed a 1000px cap. The narrowest by width (tall, 1200) is the
    // coherent fallback for a width cap, even though wide has the smaller area
    // (1,000,000 vs 1,920,000) and an area-ranked fallback would return it.
    const candidates = [
      { url: 'wide', width: 2000, height: 500 },
      { url: 'tall', width: 1200, height: 1600 },
    ];
    expect(pickBestCandidate(candidates, { maxWidth: 1000 })).toBe('tall');
  });
});

import { parsePostMedia } from '../src/platforms/instagram-api.js';

const imgSlide = (u) => ({ media_type: 1, image_versions2: { candidates: [{ url: u, width: 1080, height: 1080 }] } });
const vidSlide = (u) => ({ media_type: 2, video_versions: [{ url: u, width: 1080 }] });

describe('parsePostMedia', () => {
  it('parses a single image post', () => {
    const json = { items: [imgSlide('https://cdn.cdninstagram.com/one.jpg')] };
    const out = parsePostMedia(json, 'ABC');
    expect(out).toEqual([{ url: 'https://cdn.cdninstagram.com/one.jpg', type: 'image', filename: 'post_ABC', index: 1 }]);
  });
  it('parses a single video post', () => {
    const json = { items: [vidSlide('https://cdn.cdninstagram.com/v.mp4')] };
    const out = parsePostMedia(json, 'ABC');
    expect(out).toEqual([{ url: 'https://cdn.cdninstagram.com/v.mp4', type: 'video', filename: 'reel_ABC', index: 1 }]);
  });
  it('parses a mixed carousel in order', () => {
    const json = { items: [{ carousel_media: [imgSlide('i1'), vidSlide('v2'), imgSlide('i3')] }] };
    const out = parsePostMedia(json, 'XYZ');
    expect(out.map((o) => o.url)).toEqual(['i1', 'v2', 'i3']);
    expect(out.map((o) => o.type)).toEqual(['image', 'video', 'image']);
    expect(out.map((o) => o.filename)).toEqual(['post_XYZ_1', 'post_XYZ_2', 'post_XYZ_3']);
  });
  it('returns empty array for empty response', () => {
    expect(parsePostMedia({ items: [] }, 'ABC')).toEqual([]);
    expect(parsePostMedia({}, 'ABC')).toEqual([]);
  });
  it('skips a slide with no usable media', () => {
    const json = { items: [{ carousel_media: [imgSlide('i1'), { media_type: 1, image_versions2: { candidates: [] } }] }] };
    expect(parsePostMedia(json, 'X').map((o) => o.url)).toEqual(['i1']);
  });
});

import { extractStoryRef, parseStoryTray, mapIgStatusToMessage } from '../src/platforms/instagram-api.js';

describe('extractStoryRef', () => {
  it('parses /stories/user/123/', () => {
    expect(extractStoryRef('/stories/natgeo/1234567890/')).toEqual({ username: 'natgeo', storyId: '1234567890' });
  });
  it('returns null for non-story paths', () => {
    expect(extractStoryRef('/p/ABC/')).toBeNull();
  });
  it('returns null for highlights (not active stories, different API)', () => {
    expect(extractStoryRef('/stories/highlights/99/')).toBeNull();
  });
});

describe('parseStoryTray', () => {
  const tray = { reels_media: [{ items: [
    { pk: '111', image_versions2: { candidates: [{ url: 'a', width: 1080, height: 1920 }] } },
    { pk: '222', video_versions: [{ url: 'b', width: 720 }] },
  ] }] };
  it('returns all active stories when no storyId', () => {
    const out = parseStoryTray(tray, {});
    expect(out.map((o) => o.url)).toEqual(['a', 'b']);
    expect(out.map((o) => o.type)).toEqual(['image', 'video']);
  });
  it('returns only the matching story when storyId given', () => {
    const out = parseStoryTray(tray, { storyId: '222' });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('b');
  });
  it('returns nothing when a single story is not found (never the whole tray)', () => {
    // A stale or expired story URL must not dump every currently-active story.
    expect(parseStoryTray(tray, { storyId: 'nope' })).toEqual([]);
  });
  it('matches a single story by id prefix when pk arrives as a lossy number (#27)', () => {
    // A ~19-digit story pk exceeds Number.MAX_SAFE_INTEGER, so if the API encodes
    // pk as a JSON number it loses its low digits. The id field keeps the full pk
    // as a string (`<pk>_<userid>`), so matching on its prefix rescues the lookup.
    const bigPk = '3210000000000000123';
    const numericPkTray = { reels_media: [{ items: [
      { pk: 3210000000000000123, id: `${bigPk}_55`, image_versions2: { candidates: [{ url: 'x', width: 1080, height: 1920 }] } },
    ] }] };
    // Sanity: the pk genuinely loses precision as a number, so a pk-only match misses.
    expect(String(3210000000000000123)).not.toBe(bigPk);
    const out = parseStoryTray(numericPkTray, { storyId: bigPk });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('x');
    // The filename must carry the full lossless pk (from id), not the rounded
    // numeric pk — otherwise the download is misnamed and can collide.
    expect(out[0].filename).toBe(`story_${bigPk}`);
  });
  it('returns empty for empty tray', () => {
    expect(parseStoryTray({ reels_media: [] }, {})).toEqual([]);
  });
});

describe('mapIgStatusToMessage', () => {
  it('maps known statuses', () => {
    expect(mapIgStatusToMessage(401)).toMatch(/log in/i);
    expect(mapIgStatusToMessage(403)).toMatch(/log in/i);
    expect(mapIgStatusToMessage(429)).toMatch(/rate/i);
    expect(mapIgStatusToMessage(404)).toMatch(/expired|not found/i);
  });
  it('falls back for unknown statuses', () => {
    expect(mapIgStatusToMessage(500)).toMatch(/instagram/i);
  });
});
