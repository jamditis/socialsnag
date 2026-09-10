import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  extractFromRehydrationJson,
  extractPhotoPosts,
  extractPostId,
  extractUsername,
  extractVideoId,
  newestCapturedVideo,
  resolvePage,
} from '../src/platforms/tiktok.js';

function rehydration(itemStruct) {
  return JSON.stringify({
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { itemInfo: { itemStruct } },
    },
  });
}

describe('TikTok release boundary', () => {
  it('does not bundle the resolver before the download transport is proven', () => {
    const build = readFileSync(new URL('../build.js', import.meta.url), 'utf8');
    expect(build).not.toContain("in: 'src/platforms/tiktok.js'");
  });
});

describe('TikTok path identity', () => {
  it('extracts a video id from a video path', () => {
    expect(extractVideoId('/@janedoe/video/7412345678901234567')).toBe('7412345678901234567');
  });

  it('extracts the same post id from a photo path', () => {
    expect(extractPostId('/@janedoe/photo/7412345678901234567/')).toBe('7412345678901234567');
  });

  it('does not take an id from a profile or a non-numeric post path', () => {
    expect(extractPostId('/@janedoe')).toBeNull();
    expect(extractPostId('/@janedoe/video/not-a-number')).toBeNull();
  });

  it('decodes the username without allowing malformed escapes to break resolution', () => {
    expect(extractUsername('/@Jane%20Doe/video/7412345678901234567')).toBe('Jane Doe');
    expect(extractUsername('/@bad%ZZ/video/7412345678901234567')).toBe('bad%ZZ');
  });
});

describe('extractFromRehydrationJson', () => {
  it('builds a named video item with JSON identity', () => {
    const result = extractFromRehydrationJson(rehydration({
      id: '7412345678901234567',
      author: { uniqueId: 'janedoe' },
      video: { playAddr: 'https://v16.tiktokcdn.com/video.mp4' },
    }));
    expect(result).toEqual({
      url: 'https://v16.tiktokcdn.com/video.mp4',
      type: 'video',
      filename: 'video_7412345678901234567',
      meta: { postId: '7412345678901234567', username: 'janedoe' },
    });
  });

  it('uses the download address when no play address is present', () => {
    const result = extractFromRehydrationJson(rehydration({
      video: { downloadAddr: 'https://v16.tiktokcdn-us.com/download.mp4' },
    }), '/@janedoe/video/7412345678901234567');
    expect(result.url).toBe('https://v16.tiktokcdn-us.com/download.mp4');
    expect(result.meta).toEqual({ postId: '7412345678901234567', username: 'janedoe' });
  });

  it('accepts the first URL when TikTok supplies an address list', () => {
    const result = extractFromRehydrationJson(rehydration({
      video: { playAddr: ['', 'https://v16.tiktokcdn.com/second.mp4'] },
    }));
    expect(result.url).toBe('https://v16.tiktokcdn.com/second.mp4');
  });

  it('returns null for malformed, missing, or unplayable data', () => {
    expect(extractFromRehydrationJson('{')).toBeNull();
    expect(extractFromRehydrationJson('{}')).toBeNull();
    expect(extractFromRehydrationJson(rehydration({ video: {} }))).toBeNull();
  });
});

describe('extractPhotoPosts', () => {
  it('keeps photo order, numbering, and JSON identity', () => {
    const result = extractPhotoPosts(rehydration({
      id: '7412345678901234567',
      author: { uniqueId: 'janedoe' },
      imagePost: { images: [
        { imageURL: { urlList: ['https://p16.tiktokcdn.com/one.jpeg'] } },
        { imageURL: 'https://p16.tiktokcdn.com/two.jpeg' },
      ] },
    }));
    expect(result).toEqual([
      {
        url: 'https://p16.tiktokcdn.com/one.jpeg',
        type: 'image',
        filename: 'photo_7412345678901234567_1',
        meta: { postId: '7412345678901234567', username: 'janedoe' },
      },
      {
        url: 'https://p16.tiktokcdn.com/two.jpeg',
        type: 'image',
        filename: 'photo_7412345678901234567_2',
        meta: { postId: '7412345678901234567', username: 'janedoe' },
      },
    ]);
  });

  it('uses path identity and drops image entries with no URL', () => {
    const result = extractPhotoPosts(rehydration({
      imagePost: { images: [{ imageURL: {} }, { imageURL: 'https://p16.tiktokcdn.com/two.jpeg' }] },
    }), '/@janedoe/photo/7412345678901234567');
    expect(result).toEqual([{
      url: 'https://p16.tiktokcdn.com/two.jpeg',
      type: 'image',
      filename: 'photo_7412345678901234567_2',
      meta: { postId: '7412345678901234567', username: 'janedoe' },
    }]);
  });

  it('returns an empty list for malformed or non-photo data', () => {
    expect(extractPhotoPosts('{')).toEqual([]);
    expect(extractPhotoPosts(rehydration({ video: {} }))).toEqual([]);
  });
});

describe('newestCapturedVideo', () => {
  it('selects the newest TikTok media capture', () => {
    const result = newestCapturedVideo([
      { url: 'https://v16.tiktokcdn.com/old.mp4', type: 'media', timestamp: 10 },
      { url: 'https://v16.tiktokcdn-us.com/new.mp4', type: 'media', timestamp: 20 },
    ], '/@janedoe/video/7412345678901234567');
    expect(result).toEqual({
      url: 'https://v16.tiktokcdn-us.com/new.mp4',
      type: 'video',
      filename: 'video_7412345678901234567',
      meta: { postId: '7412345678901234567', username: 'janedoe' },
    });
  });

  it('rejects lookalike hosts and non-media captures', () => {
    expect(newestCapturedVideo([
      { url: 'https://tiktokcdn.com.attacker.example/video.mp4', type: 'media', timestamp: 20 },
      { url: 'https://v16.tiktokcdn.com/image.jpeg', type: 'image', timestamp: 10 },
    ])).toBeNull();
  });
});

describe('resolvePage', () => {
  const root = (textContent) => ({
    getElementById: () => (textContent === null ? null : { textContent }),
  });

  it('uses rehydration video data before captured media', async () => {
    const loadCaptured = vi.fn(async () => [
      { url: 'https://v16.tiktokcdn.com/captured.mp4', type: 'media', timestamp: 20 },
    ]);
    const result = await resolvePage(root(rehydration({
      video: { playAddr: 'https://v16.tiktokcdn.com/json.mp4' },
    })), '', loadCaptured);
    expect(result[0].url).toBe('https://v16.tiktokcdn.com/json.mp4');
    expect(loadCaptured).not.toHaveBeenCalled();
  });

  it('uses a captured video before photo fallback', async () => {
    const result = await resolvePage(root(rehydration({
      imagePost: { images: [{ imageURL: 'https://p16.tiktokcdn.com/photo.jpeg' }] },
    })), '', async () => [
      { url: 'https://v16.tiktokcdn.com/captured.mp4', type: 'media', timestamp: 20 },
    ]);
    expect(result).toEqual([{
      url: 'https://v16.tiktokcdn.com/captured.mp4',
      type: 'video',
      filename: null,
    }]);
  });

  it('falls back to photos and tolerates a missing script', async () => {
    const photoJson = rehydration({
      imagePost: { images: [{ imageURL: 'https://p16.tiktokcdn.com/photo.jpeg' }] },
    });
    expect(await resolvePage(root(photoJson), '', async () => [])).toHaveLength(1);
    expect(await resolvePage(root(null), '', async () => [])).toEqual([]);
  });
});
