import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  extractShortcode,
  parseMediaFromJson,
} from '../src/platforms/instagram.js';

describe('upgradeImageUrl', () => {
  it('returns null for non-IG URL', () => {
    expect(upgradeImageUrl('https://example.com/image.jpg', null)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(upgradeImageUrl(null, null)).toBeNull();
  });

  it('removes /s640x640/ size constraint', () => {
    const url = 'https://scontent.cdninstagram.com/v/t51/s640x640/photo.jpg';
    const result = upgradeImageUrl(url, null);
    expect(result).toBe('https://scontent.cdninstagram.com/v/t51/photo.jpg');
    expect(result).not.toContain('s640x640');
  });

  it('picks highest width from srcset', () => {
    const url = 'https://scontent.cdninstagram.com/v/t51/photo.jpg';
    const imgElement = {
      srcset: 'https://cdn.cdninstagram.com/small.jpg 320w, https://cdn.cdninstagram.com/large.jpg 1080w, https://cdn.cdninstagram.com/med.jpg 640w',
    };
    const result = upgradeImageUrl(url, imgElement);
    expect(result).toBe('https://cdn.cdninstagram.com/large.jpg');
  });

  it('falls back to URL upgrade when srcset is empty', () => {
    const url = 'https://scontent.cdninstagram.com/v/t51/s480x480/photo.jpg';
    const imgElement = { srcset: '' };
    const result = upgradeImageUrl(url, imgElement);
    expect(result).not.toContain('s480x480');
  });

  it('falls back to URL upgrade when imgElement has no srcset', () => {
    const url = 'https://scontent.cdninstagram.com/v/t51/s150x150/photo.jpg';
    const result = upgradeImageUrl(url, null);
    expect(result).not.toContain('s150x150');
  });
});

describe('extractShortcode', () => {
  it('extracts from /p/ABC123/', () => {
    expect(extractShortcode('/p/ABC123/')).toBe('ABC123');
  });

  it('extracts from /reel/XYZ/', () => {
    expect(extractShortcode('/reel/XYZ/')).toBe('XYZ');
  });

  it('extracts from /tv/DEF/', () => {
    expect(extractShortcode('/tv/DEF/')).toBe('DEF');
  });

  it('returns null for non-matching path', () => {
    expect(extractShortcode('/explore/')).toBeNull();
  });

  it('returns null for root path', () => {
    expect(extractShortcode('/')).toBeNull();
  });

  it('handles hyphens and underscores in shortcode', () => {
    expect(extractShortcode('/p/AB_cd-12/')).toBe('AB_cd-12');
  });
});

describe('parseMediaFromJson', () => {
  it('parses single image from ld+json', () => {
    const json = [JSON.stringify({ image: 'https://cdn.cdninstagram.com/photo.jpg' })];
    const result = parseMediaFromJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://cdn.cdninstagram.com/photo.jpg');
    expect(result[0].type).toBe('image');
    expect(result[0].index).toBe(1);
  });

  it('parses array of images', () => {
    const json = [JSON.stringify({
      image: [
        'https://cdn.cdninstagram.com/photo1.jpg',
        'https://cdn.cdninstagram.com/photo2.jpg',
      ],
    })];
    const result = parseMediaFromJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].url).toContain('photo1');
    expect(result[0].index).toBe(1);
    expect(result[1].url).toContain('photo2');
    expect(result[1].index).toBe(2);
  });

  it('ignores malformed JSON', () => {
    const json = ['not valid json', JSON.stringify({ image: 'https://cdn.cdninstagram.com/photo.jpg' })];
    const result = parseMediaFromJson(json);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no image field', () => {
    const json = [JSON.stringify({ name: 'test', type: 'WebPage' })];
    const result = parseMediaFromJson(json);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const result = parseMediaFromJson([]);
    expect(result).toHaveLength(0);
  });
});
