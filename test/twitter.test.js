import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  filterCapturedVideos,
} from '../src/platforms/twitter.js';

describe('upgradeImageUrl', () => {
  it('appends name=orig to media URLs', () => {
    const url = 'https://pbs.twimg.com/media/ABC123.jpg';
    const result = upgradeImageUrl(url);
    expect(result).toContain('name=orig');
  });

  it('replaces existing name param with orig', () => {
    const url = 'https://pbs.twimg.com/media/ABC123.jpg?name=small';
    const result = upgradeImageUrl(url);
    expect(result).toContain('name=orig');
    expect(result).not.toContain('name=small');
  });

  it('removes _normal suffix from profile pics', () => {
    const url = 'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg';
    const result = upgradeImageUrl(url);
    expect(result).not.toContain('_normal');
    expect(result).toContain('avatar.jpg');
  });

  it('removes _400x400 suffix from profile pics', () => {
    const url = 'https://pbs.twimg.com/profile_images/123/avatar_400x400.jpg';
    const result = upgradeImageUrl(url);
    expect(result).not.toContain('_400x400');
  });

  it('returns null for non-twimg URL', () => {
    expect(upgradeImageUrl('https://example.com/image.jpg')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(upgradeImageUrl(null)).toBeNull();
  });

  it('passes through other twimg.com URLs that are not /media/ or /profile_images/', () => {
    const url = 'https://pbs.twimg.com/card_img/123/photo.jpg';
    const result = upgradeImageUrl(url);
    // It should still return the URL since it contains twimg.com
    expect(result).toBe(url);
  });
});

describe('filterCapturedVideos', () => {
  it('filters to video.twimg.com .mp4 only', () => {
    const captured = [
      { url: 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/abc.mp4', timestamp: 100 },
      { url: 'https://pbs.twimg.com/media/photo.jpg', timestamp: 200 },
      { url: 'https://video.twimg.com/ext_tw_video/456/pu/vid/480x270/def.mp4', timestamp: 300 },
      { url: 'https://video.twimg.com/tweet_video/gif.mp4', timestamp: 150 },
    ];
    const result = filterCapturedVideos(captured);
    expect(result).toHaveLength(3);
    result.forEach((item) => {
      expect(item.url).toContain('video.twimg.com');
      expect(item.url).toContain('.mp4');
    });
  });

  it('sorts by timestamp descending (most recent first)', () => {
    const captured = [
      { url: 'https://video.twimg.com/v/a.mp4', timestamp: 100 },
      { url: 'https://video.twimg.com/v/b.mp4', timestamp: 300 },
      { url: 'https://video.twimg.com/v/c.mp4', timestamp: 200 },
    ];
    const result = filterCapturedVideos(captured);
    expect(result[0].timestamp).toBe(300);
    expect(result[1].timestamp).toBe(200);
    expect(result[2].timestamp).toBe(100);
  });

  it('returns empty array for empty input', () => {
    expect(filterCapturedVideos([])).toEqual([]);
  });

  it('returns empty array when no mp4 videos match', () => {
    const captured = [
      { url: 'https://pbs.twimg.com/media/photo.jpg', timestamp: 100 },
    ];
    expect(filterCapturedVideos(captured)).toEqual([]);
  });
});
