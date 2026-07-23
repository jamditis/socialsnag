import { describe, it, expect } from 'vitest';
import {
  upgradeUrl,
  extractPhotoId,
  extractVideoUrlFromScripts,
  buildImageItems,
  buildCapturedItems,
  resolvePage,
  resolveContentMessage,
} from '../src/platforms/facebook.js';

const CDN = 'https://scontent.xx.fbcdn.net/v/t1';
const img = (src, width = 500) => ({ src, width });

describe('upgradeUrl', () => {
  it('removes /s720x720/ size constraint', () => {
    const url = 'https://scontent.xx.fbcdn.net/v/t1/s720x720/photo.jpg';
    const result = upgradeUrl(url);
    expect(result).not.toContain('/s720x720/');
  });

  it('removes /p480x480/ size constraint', () => {
    const url = 'https://scontent.xx.fbcdn.net/v/t1/p480x480/photo.jpg';
    const result = upgradeUrl(url);
    expect(result).not.toContain('/p480x480/');
  });

  it('returns null for non-fbcdn URL', () => {
    expect(upgradeUrl('https://example.com/image.jpg')).toBeNull();
  });

  it('returns null when fbcdn.net appears only in the query, not the host', () => {
    expect(upgradeUrl('https://evil.com/?u=https://scontent.fbcdn.net/photo.jpg')).toBeNull();
  });

  it('returns null for a dot-boundary lookalike host', () => {
    expect(upgradeUrl('https://evilfbcdn.net/photo.jpg')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(upgradeUrl(null)).toBeNull();
  });

  it('passes through URLs without size constraint', () => {
    const url = 'https://scontent.xx.fbcdn.net/v/t1/photo.jpg';
    expect(upgradeUrl(url)).toBe(url);
  });
});

describe('extractPhotoId', () => {
  it('extracts a 10-digit numeric ID', () => {
    const url = 'https://www.facebook.com/photo/1234567890/';
    expect(extractPhotoId(url)).toBe('1234567890');
  });

  it('extracts a longer numeric ID', () => {
    const url = 'https://scontent.fbcdn.net/v/t1.6435-9/123456789012345_n.jpg';
    expect(extractPhotoId(url)).toBe('123456789012345');
  });

  it('returns null for short numbers (less than 10 digits)', () => {
    expect(extractPhotoId('https://example.com/123456789')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractPhotoId(null)).toBeNull();
  });
});

describe('extractVideoUrlFromScripts', () => {
  it('extracts HD playable URL with escaped slashes unescaped', () => {
    const scripts = [
      '{"playable_url_quality_hd":"https:\\/\\/video.xx.fbcdn.net\\/v\\/hd_video.mp4"}',
    ];
    const result = extractVideoUrlFromScripts(scripts);
    expect(result).toBe('https://video.xx.fbcdn.net/v/hd_video.mp4');
    expect(result).not.toContain('\\/');
  });

  it('falls back to SD when no HD available', () => {
    const scripts = [
      '{"playable_url":"https:\\/\\/video.xx.fbcdn.net\\/v\\/sd_video.mp4"}',
    ];
    const result = extractVideoUrlFromScripts(scripts);
    expect(result).toBe('https://video.xx.fbcdn.net/v/sd_video.mp4');
  });

  it('prefers HD over SD', () => {
    const scripts = [
      '{"playable_url":"https:\\/\\/video.xx.fbcdn.net\\/sd.mp4","playable_url_quality_hd":"https:\\/\\/video.xx.fbcdn.net\\/hd.mp4"}',
    ];
    const result = extractVideoUrlFromScripts(scripts);
    expect(result).toContain('hd.mp4');
  });

  it('returns null when no match', () => {
    const scripts = ['{"type":"WebPage","name":"test"}'];
    expect(extractVideoUrlFromScripts(scripts)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractVideoUrlFromScripts([])).toBeNull();
  });
});

describe('buildImageItems', () => {
  it('collapses size variants of one photo into a single item', () => {
    // What Facebook renders for one album slide: a grid thumbnail and the full view.
    // upgradeUrl strips the size segment, so both name the same file.
    const { items } = buildImageItems([
      img(`${CDN}/s320x320/123456789012_n.jpg`, 320),
      img(`${CDN}/p720x720/123456789012_n.jpg`, 720),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`${CDN}/123456789012_n.jpg`);
  });

  it('keeps distinct photos and numbers them in document order', () => {
    const { items } = buildImageItems([
      img(`${CDN}/s320x320/111111111111_n.jpg`),
      img(`${CDN}/s320x320/222222222222_n.jpg`),
      img(`${CDN}/s320x320/333333333333_n.jpg`),
    ]);
    expect(items.map((i) => i.filename)).toEqual([
      'photo_111111111111_1',
      'photo_222222222222_2',
      'photo_333333333333_3',
    ]);
  });

  it('does not spend an index number on a duplicate', () => {
    // The suffix is what makes a duplicate look like a separate slide, so a repeat
    // must not advance the counter either.
    const { items, index } = buildImageItems([
      img(`${CDN}/s320x320/111111111111_n.jpg`),
      img(`${CDN}/p720x720/111111111111_n.jpg`),
      img(`${CDN}/s320x320/222222222222_n.jpg`),
    ]);
    expect(items.map((i) => i.filename)).toEqual([
      'photo_111111111111_1',
      'photo_222222222222_2',
    ]);
    expect(index).toBe(3);
  });

  it('preserves the first variant seen, so ordering follows the page', () => {
    const { items } = buildImageItems([
      img(`${CDN}/s320x320/222222222222_n.jpg`),
      img(`${CDN}/s320x320/111111111111_n.jpg`),
    ]);
    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/222222222222_n.jpg`,
      `${CDN}/111111111111_n.jpg`,
    ]);
  });

  it('places a repeated photo where it first appears, not where it repeats', () => {
    // Only a non-adjacent repeat can tell first-seen from last-seen apart: adjacent
    // variants collapse to the same URL either way. Facebook renders the full view
    // of slide one after the rest of the grid, so this is the real layout, and
    // first-seen is what keeps the download order matching the album.
    const { items } = buildImageItems([
      img(`${CDN}/s320x320/111111111111_n.jpg`),
      img(`${CDN}/s320x320/222222222222_n.jpg`),
      img(`${CDN}/p720x720/111111111111_n.jpg`),
    ]);
    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/111111111111_n.jpg`,
      `${CDN}/222222222222_n.jpg`,
    ]);
  });

  it('skips reaction icons and avatars by size', () => {
    const { items } = buildImageItems([
      img(`${CDN}/s320x320/111111111111_n.jpg`, 16),
      img(`${CDN}/s320x320/222222222222_n.jpg`, 500),
    ]);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/222222222222_n.jpg`]);
  });

  it('keeps an image that has not laid out yet', () => {
    // Below-the-fold images report width 0; dropping them would lose real slides.
    const { items } = buildImageItems([{ src: `${CDN}/s320x320/111111111111_n.jpg`, width: 0 }]);
    expect(items).toHaveLength(1);
  });

  it('ignores non-fbcdn images', () => {
    const { items } = buildImageItems([img('https://example.com/photo.jpg')]);
    expect(items).toEqual([]);
  });

  it('leaves the filename null when no photo id is present', () => {
    const { items } = buildImageItems([img(`${CDN}/s320x320/short_n.jpg`)]);
    expect(items[0].filename).toBeNull();
  });

  it('continues numbering from the index it is given', () => {
    const { items } = buildImageItems([img(`${CDN}/s320x320/111111111111_n.jpg`)], 4);
    expect(items[0].filename).toBe('photo_111111111111_4');
  });
});

describe('buildCapturedItems', () => {
  const cap = (url) => ({ url, type: 'image' });

  it('dedupes before capping, so the cap counts distinct photos', () => {
    // Order matters: capping first lets one repeated photo fill every slot and push
    // out real ones.
    const captured = [
      cap(`${CDN}/a_111111111111_n.jpg`),
      cap(`${CDN}/a_111111111111_n.jpg`),
      cap(`${CDN}/a_111111111111_n.jpg`),
      cap(`${CDN}/b_222222222222_n.jpg`),
      cap(`${CDN}/c_333333333333_n.jpg`),
    ];
    const { items, dropped } = buildCapturedItems(captured, 5);
    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/a_111111111111_n.jpg`,
      `${CDN}/b_222222222222_n.jpg`,
      `${CDN}/c_333333333333_n.jpg`,
    ]);
    expect(dropped).toBe(0);
  });

  it('reports how many it dropped rather than truncating silently', () => {
    const captured = Array.from({ length: 8 }, (_, i) => cap(`${CDN}/p${i}_11111111111${i}_n.jpg`));
    const { items, dropped } = buildCapturedItems(captured, 5);
    expect(items).toHaveLength(5);
    expect(dropped).toBe(3);
  });

  it('lets a re-requested photo keep its place near the front of the queue', () => {
    // The capture store spans posts already scrolled past. A photo requested again
    // belongs to what is on screen now, so its latest sighting is what counts:
    // ranking it by its first sighting would age it out in favour of an older one.
    const captured = [
      cap(`${CDN}/old_111111111111_n.jpg`),
      cap(`${CDN}/b_222222222222_n.jpg`),
      cap(`${CDN}/c_333333333333_n.jpg`),
      cap(`${CDN}/old_111111111111_n.jpg`),
    ];
    const { items } = buildCapturedItems(captured, 2);
    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/c_333333333333_n.jpg`,
      `${CDN}/old_111111111111_n.jpg`,
    ]);
  });

  it('keeps the most recent captures', () => {
    const captured = [cap(`${CDN}/old_n.jpg`), cap(`${CDN}/mid_n.jpg`), cap(`${CDN}/new_n.jpg`)];
    const { items } = buildCapturedItems(captured, 2);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/mid_n.jpg`, `${CDN}/new_n.jpg`]);
  });

  it('rejects a lookalike host rather than matching the string anywhere', () => {
    // Same host check upgradeUrl already applies. The capture path used a bare
    // substring match, so these two reached the download list.
    const captured = [
      cap('https://evilfbcdn.net/photo.jpg'),
      cap('https://evil.com/?u=https://scontent.fbcdn.net/photo.jpg'),
      cap(`${CDN}/real_111111111111_n.jpg`),
    ];
    const { items } = buildCapturedItems(captured, 5);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/real_111111111111_n.jpg`]);
  });

  it('ignores captured video entries', () => {
    const captured = [{ url: `${CDN}/clip.mp4`, type: 'video' }, cap(`${CDN}/photo_n.jpg`)];
    const { items } = buildCapturedItems(captured, 5);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/photo_n.jpg`]);
  });

  it('survives a malformed capture entry', () => {
    const { items } = buildCapturedItems([null, {}, cap(`${CDN}/photo_n.jpg`)], 5);
    expect(items).toHaveLength(1);
  });

  it('collapses size variants the way the DOM path does', () => {
    // The browser requests whichever size it renders, so one photo shown small and
    // then large is captured twice. Keying on the raw URL would call that two photos
    // and hand back the thumbnail to download.
    const { items } = buildCapturedItems([
      cap(`${CDN}/s320x320/123456789012_n.jpg`),
      cap(`${CDN}/p720x720/123456789012_n.jpg`),
    ], 5);
    expect(items.map((i) => i.url)).toEqual([`${CDN}/123456789012_n.jpg`]);
  });

  it('numbers from one, since it only runs when the DOM walk found nothing', () => {
    const { items } = buildCapturedItems([cap(`${CDN}/a_n.jpg`), cap(`${CDN}/b_n.jpg`)], 5);
    expect(items.map((i) => i.filename)).toEqual(['photo_1', 'photo_2']);
  });
});

describe('resolvePage', () => {
  const makePost = (pageUrl, src) => {
    const media = img(src);
    const permalink = { href: pageUrl };
    return {
      matches: (selector) => selector === '[role="article"]',
      parentElement: null,
      querySelectorAll: (selector) => {
        if (selector === 'img[src*="fbcdn.net"]') return [media];
        if (selector === 'a[href]') return [permalink];
        return [];
      },
    };
  };

  it('resolves the direct post without a right-click target', async () => {
    const pageUrl = 'https://www.facebook.com/example/posts/1234567890/';
    const post = makePost(pageUrl, `${CDN}/s720x720/123456789012_n.jpg`);
    const root = { querySelectorAll: () => [post] };

    const items = await resolvePage(root, pageUrl);

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`${CDN}/123456789012_n.jpg`);
  });

  it('handles a resolvePage message without a stored right-click target', async () => {
    const pageUrl = 'https://www.facebook.com/example/posts/1234567890/';
    const post = makePost(pageUrl, `${CDN}/s720x720/123456789012_n.jpg`);
    const root = { querySelectorAll: () => [post] };

    const items = await resolveContentMessage({
      action: 'resolvePage',
      pageUrl,
    }, null, root);

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`${CDN}/123456789012_n.jpg`);
  });

  it('resolves a direct photo-viewer image without a right-click target', async () => {
    const pageUrl = 'https://www.facebook.com/photo.php?fbid=123456789012&id=42';
    const media = {
      tagName: 'IMG',
      src: `${CDN}/p720x720/123456789012_n.jpg`,
      matches: () => false,
      parentElement: null,
    };
    const permalink = {
      href: pageUrl,
      querySelector: (selector) => selector.includes('media-vc-image') ? media : null,
    };
    const root = {
      querySelectorAll: (selector) => selector === 'a[href]' ? [permalink] : [],
    };

    const items = await resolvePage(root, pageUrl);

    expect(items).toEqual([{
      url: `${CDN}/123456789012_n.jpg`,
      type: 'image',
      filename: 'photo_123456789012',
    }]);
  });

  it('does not treat a broad main container avatar as the submitted post', async () => {
    const root = { querySelectorAll: () => [] };

    expect(await resolvePage(
      root,
      'https://www.facebook.com/example/posts/1234567890/',
    )).toEqual([]);
  });

  it('chooses the container whose permalink matches the submitted post URL', async () => {
    const unrelated = makePost(
      'https://www.facebook.com/example/posts/111/',
      `${CDN}/s720x720/111111111111_n.jpg`,
    );
    const requested = makePost(
      'https://www.facebook.com/example/posts/222/',
      `${CDN}/s720x720/222222222222_n.jpg`,
    );
    const root = { querySelectorAll: () => [unrelated, requested] };

    const items = await resolvePage(
      root,
      'https://www.facebook.com/example/posts/222/',
    );

    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('222222222222_n.jpg');
    expect(items[0].url).not.toContain('111111111111_n.jpg');
  });

  it('returns no media when no container proves the submitted post identifier', async () => {
    const unrelated = makePost(
      'https://www.facebook.com/example/posts/111/',
      `${CDN}/s720x720/111111111111_n.jpg`,
    );
    const root = { querySelectorAll: () => [unrelated] };

    expect(await resolvePage(
      root,
      'https://www.facebook.com/example/posts/999/',
    )).toEqual([]);
  });
});
