import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  extractShortcode,
  parseMediaFromJson,
  extractVideoUrlFromScripts,
  shortcodeFromContainer,
  buildImageItems,
  mergeCapturedImages,
  collectMediaFromContainer,
  resolveSingle,
} from '../src/platforms/instagram.js';

describe('upgradeImageUrl', () => {
  it('returns null for non-IG URL', () => {
    expect(upgradeImageUrl('https://example.com/image.jpg', null)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(upgradeImageUrl(null, null)).toBeNull();
  });

  it('returns null when cdninstagram.com appears only in the query, not the host', () => {
    expect(upgradeImageUrl('https://evil.com/?u=https://scontent.cdninstagram.com/p.jpg', null)).toBeNull();
  });

  it('returns null for a dot-boundary lookalike host', () => {
    expect(upgradeImageUrl('https://evilcdninstagram.com/p.jpg', null)).toBeNull();
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

  it('applies a resolution cap to srcset candidates', () => {
    const url = 'https://scontent.cdninstagram.com/v/t51/photo.jpg';
    const imgElement = {
      srcset: 'https://cdn.cdninstagram.com/small.jpg 320w, https://cdn.cdninstagram.com/large.jpg 1080w, https://cdn.cdninstagram.com/med.jpg 640w',
    };

    expect(upgradeImageUrl(url, imgElement, { maxWidth: 720 }))
      .toBe('https://cdn.cdninstagram.com/med.jpg');
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

describe('extractVideoUrlFromScripts', () => {
  it('extracts video_url from IG JSON in script text', () => {
    const scriptText = '{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/t50\\/video.mp4"}';
    const result = extractVideoUrlFromScripts([scriptText]);
    expect(result).toBe('https://scontent.cdninstagram.com/v/t50/video.mp4');
  });

  it('extracts URL from video_versions array format', () => {
    const scriptText = '{"video_versions":[{"url":"https:\\/\\/scontent.cdninstagram.com\\/v\\/t50\\/hd_video.mp4","width":1080}]}';
    const result = extractVideoUrlFromScripts([scriptText]);
    expect(result).toBe('https://scontent.cdninstagram.com/v/t50/hd_video.mp4');
  });

  it('unescapes forward slashes in extracted URLs', () => {
    const scriptText = 'window.__data={"video_url":"https:\\/\\/scontent-lax3-1.cdninstagram.com\\/v\\/t50.2886-16\\/abc123.mp4?efg=abc\\u0026oh=def"}';
    const result = extractVideoUrlFromScripts([scriptText]);
    expect(result).toContain('https://scontent-lax3-1.cdninstagram.com/v/t50.2886-16/abc123.mp4');
    expect(result).not.toContain('\\/');
    expect(result).toContain('&');
    expect(result).not.toContain('\\u0026');
  });

  it('returns null when no video URLs are present', () => {
    const scriptText = '{"image_url":"https://scontent.cdninstagram.com/photo.jpg","type":"GraphImage"}';
    const result = extractVideoUrlFromScripts([scriptText]);
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractVideoUrlFromScripts([])).toBeNull();
  });

  it('searches multiple script texts and returns first match', () => {
    const scripts = [
      '{"unrelated":"data"}',
      '{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/first.mp4"}',
      '{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/second.mp4"}',
    ];
    const result = extractVideoUrlFromScripts(scripts);
    expect(result).toBe('https://scontent.cdninstagram.com/first.mp4');
  });

  it('skips null and empty script texts', () => {
    const scripts = [null, '', '{"video_url":"https:\\/\\/scontent.cdninstagram.com\\/video.mp4"}'];
    const result = extractVideoUrlFromScripts(scripts);
    expect(result).toBe('https://scontent.cdninstagram.com/video.mp4');
  });
});

describe('shortcodeFromContainer', () => {
  it('picks the post permalink and ignores profile and explore links', () => {
    // A feed article's header links to /username/, the timestamp links to the
    // post permalink; only the permalink carries the shortcode.
    expect(shortcodeFromContainer(['/theuser/', '/p/CxYz-1_aB/', '/explore/tags/x/']))
      .toBe('CxYz-1_aB');
  });

  it('matches /reel/ and /tv/ permalinks too', () => {
    expect(shortcodeFromContainer(['/reel/AbC123/'])).toBe('AbC123');
    expect(shortcodeFromContainer(['/tv/XyZ789/'])).toBe('XyZ789');
  });

  it('returns the first permalink when several are present', () => {
    expect(shortcodeFromContainer(['/p/first_ONE/', '/p/second_TWO/'])).toBe('first_ONE');
  });

  it('returns null when no permalink is present', () => {
    expect(shortcodeFromContainer(['/theuser/', '/explore/', null, undefined])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(shortcodeFromContainer([])).toBeNull();
  });
});

describe('resolveSingle', () => {
  it('keeps a feed profile avatar untagged from the article post', () => {
    const postPermalink = {
      tagName: 'A',
      getAttribute: () => '/p/CxArticle/',
      parentElement: null,
    };
    const profileLink = {
      tagName: 'A',
      getAttribute: () => '/alice/',
      parentElement: null,
    };
    const article = {
      tagName: 'ARTICLE',
      parentElement: null,
      querySelectorAll: (selector) => selector === 'a[href]' ? [postPermalink] : [],
    };
    const target = {
      tagName: 'IMG',
      src: `${CDN}/s150x150/AVATAR_n.jpg`,
      srcset: '',
      parentElement: profileLink,
      closest: (selector) => selector === 'article' ? article : null,
    };
    postPermalink.parentElement = article;
    profileLink.parentElement = article;

    expect(resolveSingle(target.src, target, '/alice/')).toEqual([{
      url: `${CDN}/AVATAR_n.jpg`,
      type: 'image',
      filename: null,
    }]);
  });

  it('does not tag a page-wide script video with the clicked shortcode', () => {
    const originalDocument = globalThis.document;
    const permalink = {
      tagName: 'A',
      getAttribute: () => '/p/CxClicked/',
      parentElement: null,
    };
    const target = {
      tagName: 'VIDEO',
      src: 'blob:https://www.instagram.com/video',
      parentElement: permalink,
      closest: () => null,
    };
    globalThis.document = {
      querySelectorAll: (selector) => selector === 'script'
        ? [{ textContent: '{"video_url":"https://scontent.cdninstagram.com/page-wide.mp4"}' }]
        : [],
    };

    try {
      expect(resolveSingle('', target, '/p/CxPage/')).toEqual([{
        url: 'https://scontent.cdninstagram.com/page-wide.mp4',
        type: 'video',
        filename: 'reel_CxPage',
      }]);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('uses the clicked profile-grid permalink for item metadata', () => {
    const permalink = {
      tagName: 'A',
      getAttribute: () => '/p/CxGrid42/',
      parentElement: null,
    };
    const target = {
      tagName: 'IMG',
      src: `${CDN}/s640x640/GRID_n.jpg`,
      srcset: '',
      parentElement: permalink,
    };

    expect(resolveSingle(target.src, target, '/alice/')).toEqual([{
      url: `${CDN}/GRID_n.jpg`,
      type: 'image',
      filename: null,
      meta: { postId: 'CxGrid42' },
    }]);
  });

  it('prefers the clicked permalink over a different post in the page URL', () => {
    const permalink = {
      tagName: 'A',
      getAttribute: () => '/p/CxClicked/',
      parentElement: null,
    };
    const target = {
      tagName: 'IMG',
      src: `${CDN}/s640x640/RELATED_n.jpg`,
      srcset: '',
      parentElement: permalink,
    };

    expect(resolveSingle(target.src, target, '/p/CxPage/')).toEqual([{
      url: `${CDN}/RELATED_n.jpg`,
      type: 'image',
      filename: 'post_CxPage',
      meta: { postId: 'CxClicked' },
    }]);
  });
});

const CDN = 'https://scontent.cdninstagram.com/v/t51.2885-15';

describe('buildImageItems', () => {
  // The first task #46 names: find out whether upgradeImageUrl collapses Instagram's
  // size variants the way Facebook's does, since that is what decides whether the
  // missing dedupe permits duplicates or produces them. These two answer it, and the
  // answer is that both branches collapse, so it produces them.
  it('collapses the size variants of one slide when neither img has a srcset', () => {
    const { items } = buildImageItems([
      { src: `${CDN}/s150x150/AAA_n.jpg` },
      { src: `${CDN}/s640x640/AAA_n.jpg` },
    ], 'CxYz1');

    expect(items).toEqual([{
      url: `${CDN}/AAA_n.jpg`,
      type: 'image',
      filename: 'post_CxYz1_1',
      meta: { postId: 'CxYz1' },
    }]);
  });

  it('collapses two imgs for one slide that share a srcset', () => {
    const srcset = `${CDN}/s320x320/AAA_n.jpg 320w, ${CDN}/s1080x1080/AAA_n.jpg 1080w`;
    const { items } = buildImageItems([
      { src: `${CDN}/s150x150/AAA_n.jpg`, srcset },
      { src: `${CDN}/s640x640/AAA_n.jpg`, srcset },
    ], 'CxYz1');

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`${CDN}/s1080x1080/AAA_n.jpg`);
  });

  // The seam in that collapse, pinned so a later reader does not mistake it for a
  // dedupe bug. The srcset branch returns its winner untouched and the fallback
  // strips the size segment, so one photo rendered both ways upgrades to two URLs.
  it('does NOT collapse a srcset img against a bare img for the same photo', () => {
    const { items } = buildImageItems([
      { src: `${CDN}/s640x640/AAA_n.jpg`, srcset: `${CDN}/s1080x1080/AAA_n.jpg 1080w` },
      { src: `${CDN}/s640x640/AAA_n.jpg` },
    ], 'CxYz1');

    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/s1080x1080/AAA_n.jpg`,
      `${CDN}/AAA_n.jpg`,
    ]);
  });

  it('keeps distinct photos, in document order, numbered from 1', () => {
    const { items, index } = buildImageItems([
      { src: `${CDN}/s640x640/AAA_n.jpg` },
      { src: `${CDN}/s640x640/BBB_n.jpg` },
      { src: `${CDN}/s150x150/AAA_n.jpg` },
      { src: `${CDN}/s640x640/CCC_n.jpg` },
    ], 'CxYz1');

    expect(items.map((i) => i.url)).toEqual([
      `${CDN}/AAA_n.jpg`,
      `${CDN}/BBB_n.jpg`,
      `${CDN}/CCC_n.jpg`,
    ]);
    expect(items.map((i) => i.filename)).toEqual([
      'post_CxYz1_1', 'post_CxYz1_2', 'post_CxYz1_3',
    ]);
    expect(index).toBe(4);
  });

  // The returned index is what the video loop numbers from, so a repeat must not
  // burn a slot. Before the dedupe, four imgs for three photos left the first clip
  // at _5 and the saved set looked like it was missing a file.
  it('does not spend an index on a duplicate, so video numbering stays contiguous', () => {
    const { index } = buildImageItems([
      { src: `${CDN}/s640x640/AAA_n.jpg` },
      { src: `${CDN}/s150x150/AAA_n.jpg` },
    ], 'CxYz1', 1);

    expect(index).toBe(2);
  });

  // Two media ids stay two items. Named for the ids rather than for the pictures,
  // because that is what this can check: whether a repeated picture reaches the DOM as
  // two ids is a claim about the CDN, and the buildImageItems comment says so.
  it('keeps two images that differ only in their media id', () => {
    const { items } = buildImageItems([
      { src: `${CDN}/s640x640/17912345678901234_n.jpg` },
      { src: `${CDN}/s640x640/17998765432109876_n.jpg` },
    ], 'CxYz1');

    expect(items.map((i) => i.filename)).toEqual(['post_CxYz1_1', 'post_CxYz1_2']);
  });

  it('honours startIndex', () => {
    const { items, index } = buildImageItems([{ src: `${CDN}/s640x640/AAA_n.jpg` }], 'CxYz1', 4);
    expect(items[0].filename).toBe('post_CxYz1_4');
    expect(index).toBe(5);
  });

  it('drops anything upgradeImageUrl rejects, including a lookalike host', () => {
    const { items } = buildImageItems([
      { src: 'https://evilcdninstagram.com/AAA_n.jpg' },
      { src: 'https://example.com/AAA_n.jpg' },
      { src: null },
      {},
    ], 'CxYz1');

    expect(items).toEqual([]);
  });

  it('leaves the filename null when the post has no shortcode', () => {
    const { items } = buildImageItems([{ src: `${CDN}/s640x640/AAA_n.jpg` }], null);
    expect(items[0].filename).toBeNull();
    expect(items[0].meta).toBeUndefined();
  });

  // resolveAll reads a small media count as a sparse DOM and falls back to the
  // page-wide webRequest captures, which reach into neighbouring posts. So the count
  // it reads has to survive the dedupe: an ordinary single-photo post rendered at two
  // sizes is a full DOM, and reporting it as sparse would pull a stranger's photos
  // into the download.
  it('reports what the DOM offered, not what survived the dedupe', () => {
    const { items, considered } = buildImageItems([
      { src: `${CDN}/s150x150/AAA_n.jpg` },
      { src: `${CDN}/s640x640/AAA_n.jpg` },
    ], 'CxYz1');

    expect(items).toHaveLength(1);
    expect(considered).toBe(2);
  });

  it('does not count an image upgradeImageUrl rejected as offered', () => {
    const { considered } = buildImageItems([
      { src: `${CDN}/s640x640/AAA_n.jpg` },
      { src: 'https://example.com/AAA_n.jpg' },
    ], 'CxYz1');

    expect(considered).toBe(1);
  });

  it('returns nothing for an empty list', () => {
    expect(buildImageItems([], 'CxYz1')).toEqual({ items: [], index: 1, considered: 0 });
  });
});

describe('mergeCapturedImages', () => {
  const domItem = { url: `${CDN}/AAA_n.jpg`, type: 'image', filename: 'post_CxYz1_1' };

  // The defect this replaced: the old guard compared a raw captured URL against the
  // upgraded URLs already in `items`, so it never matched. One photo arrived as its DOM
  // entry plus two captured renditions and saved three times, two of them at the
  // thumbnail size the upgrade exists to get past.
  it('does not re-add a photo already found in the DOM at another size', () => {
    const { items, index } = mergeCapturedImages(
      [domItem],
      [
        { url: `${CDN}/s150x150/AAA_n.jpg`, type: 'image' },
        { url: `${CDN}/s640x640/AAA_n.jpg`, type: 'image' },
      ],
      'CxYz1',
      2,
    );

    expect(items).toEqual([domItem]);
    expect(index).toBe(2);
  });

  it('appends a genuinely different photo, upgraded rather than raw', () => {
    const { items, index } = mergeCapturedImages(
      [domItem],
      [{ url: `${CDN}/s150x150/BBB_n.jpg`, type: 'image' }],
      'CxYz1',
      2,
    );

    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      url: `${CDN}/BBB_n.jpg`,
      type: 'image',
      filename: 'post_CxYz1_2',
    });
    expect(index).toBe(3);
  });

  it('collapses two captured renditions of one photo into a single item', () => {
    const { items } = mergeCapturedImages([], [
      { url: `${CDN}/s150x150/BBB_n.jpg`, type: 'image' },
      { url: `${CDN}/s640x640/BBB_n.jpg`, type: 'image' },
    ], 'CxYz1');

    expect(items.map((i) => i.url)).toEqual([`${CDN}/BBB_n.jpg`]);
  });

  // The host check rides on upgradeImageUrl, which is stricter than the substring test
  // it replaced: `evilcdninstagram.com` contains `cdninstagram.com`.
  it('drops a lookalike host, a foreign host, and a captured video', () => {
    const { items } = mergeCapturedImages([], [
      { url: 'https://evilcdninstagram.com/BBB_n.jpg', type: 'image' },
      { url: 'https://example.com/BBB_n.jpg', type: 'image' },
      { url: `${CDN}/CCC_n.mp4`, type: 'video' },
    ], 'CxYz1');

    expect(items).toEqual([]);
  });

  // Dedupe first, then cap, so the cap is spent on distinct photos rather than on
  // repeats of one. Capture order is network arrival order, so the last are the
  // likeliest to belong to the post just opened.
  it('spends the cap on distinct photos and keeps the most recent', () => {
    const captured = [
      { url: `${CDN}/s150x150/AAA_n.jpg`, type: 'image' },
      { url: `${CDN}/s640x640/AAA_n.jpg`, type: 'image' },
      { url: `${CDN}/s640x640/BBB_n.jpg`, type: 'image' },
      { url: `${CDN}/s640x640/CCC_n.jpg`, type: 'image' },
    ];

    const { items } = mergeCapturedImages([], captured, 'CxYz1', 1, 2);

    expect(items.map((i) => i.url)).toEqual([`${CDN}/BBB_n.jpg`, `${CDN}/CCC_n.jpg`]);
  });

  // The cap keeps the tail, so where a repeat sits decides whether it survives the cap.
  // A photo a neighbouring post requested first and this post requested again belongs to
  // this post. First-seen ordering would have left it at the neighbour's position, where
  // the cap drops it.
  it('moves a re-requested photo to the end so the cap keeps it', () => {
    const captured = [
      { url: `${CDN}/AAA_n.jpg`, type: 'image' },
      { url: `${CDN}/BBB_n.jpg`, type: 'image' },
      { url: `${CDN}/CCC_n.jpg`, type: 'image' },
      { url: `${CDN}/s640x640/AAA_n.jpg`, type: 'image' },
    ];

    const { items } = mergeCapturedImages([], captured, 'CxYz1', 1, 2);

    expect(items.map((i) => i.url)).toEqual([`${CDN}/CCC_n.jpg`, `${CDN}/AAA_n.jpg`]);
  });

  it('reports how many distinct captures the cap left out', () => {
    const captured = ['AAA', 'BBB', 'CCC'].map((id) => ({ url: `${CDN}/${id}_n.jpg`, type: 'image' }));

    expect(mergeCapturedImages([], captured, 'CxYz1', 1, 2).dropped).toBe(1);
    expect(mergeCapturedImages([], captured, 'CxYz1', 1, 10).dropped).toBe(0);
  });

  // The srcset branch returns its winner untouched (#70), so a DOM item can carry a size
  // segment that the same photo's capture does not. Comparing the two raw appends it twice.
  it('does not re-add a photo whose DOM item kept a srcset size segment', () => {
    const fromSrcset = { url: `${CDN}/s1080x1080/AAA_n.jpg`, type: 'image', filename: 'post_CxYz1_1' };
    const captured = [{ url: `${CDN}/s640x640/AAA_n.jpg`, type: 'image' }];

    const { items } = mergeCapturedImages([fromSrcset], captured, 'CxYz1', 2);

    expect(items).toEqual([fromSrcset]);
  });

  it('leaves the DOM items untouched when there is nothing to add', () => {
    const original = [domItem];
    const { items } = mergeCapturedImages(original, [], 'CxYz1', 2);

    expect(items).toEqual(original);
    expect(items).not.toBe(original);
  });
});

describe('collectMediaFromContainer', () => {
  it('does not tag a page-wide script video with the container shortcode', () => {
    const originalDocument = globalThis.document;
    const video = { src: 'blob:https://www.instagram.com/video' };
    const post = {
      querySelectorAll: (selector) => {
        if (selector === 'video') return [video];
        return [];
      },
    };
    globalThis.document = {
      querySelectorAll: (selector) => selector === 'script'
        ? [{ textContent: '{"video_url":"https://scontent.cdninstagram.com/page-wide.mp4"}' }]
        : [],
    };

    try {
      const { items } = collectMediaFromContainer(post, 'CxContainer');
      expect(items).toEqual([{
        url: 'https://scontent.cdninstagram.com/page-wide.mp4',
        type: 'video',
        filename: 'post_CxContainer_1',
      }]);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  // The seam this change could regress silently. resolveAll reads domCount to decide
  // whether the DOM looked sparse, and a sparse DOM sends it to the page-wide captures,
  // which reach into neighbouring posts. So the two numbers have to diverge here: one
  // photo rendered at two sizes is one item and a full DOM.
  const container = (imgs) => ({
    querySelectorAll: (sel) => (sel === 'video' ? [] : imgs),
  });

  it('reports one item and a domCount of two for one photo at two sizes', () => {
    const { items, domCount } = collectMediaFromContainer(container([
      { src: `${CDN}/s150x150/AAA_n.jpg` },
      { src: `${CDN}/s640x640/AAA_n.jpg` },
    ]), 'CxYz1');

    expect(items).toHaveLength(1);
    expect(domCount).toBe(2);
  });

  it('reports a domCount of one for a genuinely single-image post', () => {
    const { domCount } = collectMediaFromContainer(
      container([{ src: `${CDN}/s640x640/AAA_n.jpg` }]),
      'CxYz1',
    );

    expect(domCount).toBe(1);
  });

  it('does not count an image upgradeImageUrl rejected', () => {
    const { items, domCount } = collectMediaFromContainer(container([
      { src: 'https://evilcdninstagram.com/AAA_n.jpg' },
    ]), 'CxYz1');

    expect(items).toEqual([]);
    expect(domCount).toBe(0);
  });
});
