import { describe, it, expect } from 'vitest';
import { shortcodeToMediaId, pickBestCandidate, pickBestVideo } from '../src/platforms/instagram-api.js';

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
