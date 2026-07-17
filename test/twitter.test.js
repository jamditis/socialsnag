import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  filterCapturedVideos,
  insideQuotedTweet,
  findTweetScope,
  statusIdInScope,
  scopeHasVideo,
  imageInScope,
} from '../src/platforms/twitter.js';

// Minimal DOM stub in the same plain-object style as common.test.js. A node
// carries the selectors it matches (`is`), and containers answer querySelector
// over their own subtree, so the resolver's walks run against these exactly as
// against a real page. selMatch only covers the selectors the resolver uses.
function selMatch(node, sel) {
  if (sel === 'video') return node.tagName === 'VIDEO';
  if (sel === 'a[href*="/status/"]') {
    return node.tagName === 'A' && (node.href || '').includes('/status/');
  }
  if (sel === 'img[src*="pbs.twimg.com/media/"]') {
    return node.tagName === 'IMG' && (node.src || '').includes('pbs.twimg.com/media/');
  }
  return (node.is || []).includes(sel);
}

function makeNode({ tag = 'DIV', is = [], href, src, children = [] } = {}) {
  const node = { tagName: tag, href, src, is };
  node.matches = (sel) => selMatch(node, sel);
  const descendants = [];
  const collect = (kids) => kids.forEach((k) => { descendants.push(k); collect(k.children || []); });
  collect(children);
  children.forEach((c) => { c.parentElement = node; });
  node.children = children;
  node.querySelector = (sel) => descendants.find((d) => selMatch(d, sel)) || null;
  node.querySelectorAll = (sel) => descendants.filter((d) => selMatch(d, sel));
  node.parentElement = null;
  return node;
}

// A main tweet whose article also contains a quoted tweet, each with its own
// permalink and media. This is the shape that made the old resolver attribute
// quoted media to the parent.
function quotedTweetTree({ mainVideo = false, quotedVideo = false } = {}) {
  const mainStatus = makeNode({ tag: 'A', href: '/main/status/111' });
  const mainImg = makeNode({ tag: 'IMG', src: 'https://pbs.twimg.com/media/MAIN.jpg' });
  const quotedStatus = makeNode({ tag: 'A', href: '/other/status/222' });
  const quotedImg = makeNode({ tag: 'IMG', src: 'https://pbs.twimg.com/media/QUOTE.jpg' });
  const quotedChildren = [quotedStatus, quotedImg];
  if (quotedVideo) quotedChildren.push(makeNode({ tag: 'VIDEO' }));
  const quoted = makeNode({ is: ['div[role="link"][tabindex]'], children: quotedChildren });

  const mainChildren = [mainStatus, mainImg];
  if (mainVideo) mainChildren.push(makeNode({ tag: 'VIDEO' }));
  mainChildren.push(quoted);
  const article = makeNode({
    tag: 'ARTICLE',
    is: ['article[data-testid="tweet"]', 'article[role="article"]'],
    children: mainChildren,
  });
  return { article, mainStatus, mainImg, quoted, quotedStatus, quotedImg };
}

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

  it('returns null when twimg.com appears only in the query, not the host', () => {
    expect(upgradeImageUrl('https://evil.com/?u=https://video.twimg.com/x.mp4')).toBeNull();
  });

  it('returns null for a dot-boundary lookalike host', () => {
    expect(upgradeImageUrl('https://eviltwimg.com/x.jpg')).toBeNull();
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

describe('insideQuotedTweet', () => {
  it('returns the quoted wrapper for a node inside a quoted tweet', () => {
    const t = quotedTweetTree();
    expect(insideQuotedTweet(t.quotedImg, t.article)).toBe(t.quoted);
  });

  it('returns null for a node in the main tweet', () => {
    const t = quotedTweetTree();
    expect(insideQuotedTweet(t.mainImg, t.article)).toBeNull();
  });

  it('does not treat a link-preview card as a quoted tweet', () => {
    // A card is a role="link" wrapper like a quote, but links out rather than to
    // a /status/ permalink, so it must not be scoped away from the main tweet.
    const cardImg = makeNode({ tag: 'IMG', src: 'https://pbs.twimg.com/card_img/9/x.jpg' });
    const cardLink = makeNode({ tag: 'A', href: 'https://example.com/article' });
    const card = makeNode({ is: ['div[role="link"][tabindex]'], children: [cardLink, cardImg] });
    const article = makeNode({
      tag: 'ARTICLE',
      is: ['article[data-testid="tweet"]', 'article[role="article"]'],
      children: [card],
    });
    expect(insideQuotedTweet(cardImg, article)).toBeNull();
  });
});

describe('findTweetScope', () => {
  it('returns null off any tweet', () => {
    const loose = makeNode({ tag: 'IMG' });
    expect(findTweetScope(loose)).toBeNull();
  });

  it('scopes a main-tweet click to the article', () => {
    const t = quotedTweetTree();
    const found = findTweetScope(t.mainImg);
    expect(found.scope).toBe(t.article);
    expect(found.isQuoted).toBe(false);
  });

  it('scopes a quoted-tweet click to the quoted block', () => {
    const t = quotedTweetTree();
    const found = findTweetScope(t.quotedImg);
    expect(found.scope).toBe(t.quoted);
    expect(found.isQuoted).toBe(true);
  });

  it('scopes a click on card media to the main tweet, not the card', () => {
    const cardImg = makeNode({ tag: 'IMG', src: 'https://pbs.twimg.com/card_img/9/x.jpg' });
    const cardLink = makeNode({ tag: 'A', href: 'https://example.com/article' });
    const card = makeNode({ is: ['div[role="link"][tabindex]'], children: [cardLink, cardImg] });
    const mainStatus = makeNode({ tag: 'A', href: '/main/status/111' });
    const article = makeNode({
      tag: 'ARTICLE',
      is: ['article[data-testid="tweet"]', 'article[role="article"]'],
      children: [mainStatus, card],
    });
    const found = findTweetScope(cardImg);
    expect(found.scope).toBe(article);
    expect(found.isQuoted).toBe(false);
    expect(statusIdInScope(found)).toBe('111');
  });
});

describe('statusIdInScope', () => {
  it('returns the main tweet id for a main-tweet click, not the quoted one', () => {
    const t = quotedTweetTree();
    expect(statusIdInScope(findTweetScope(t.mainImg))).toBe('111');
  });

  it('returns the quoted tweet id for a quoted-tweet click', () => {
    const t = quotedTweetTree();
    expect(statusIdInScope(findTweetScope(t.quotedImg))).toBe('222');
  });

  it('picks the main tweet id by the quote filter, not by DOM order', () => {
    // Same shape as the main tree but with the quoted block placed before the
    // main permalink. If the id came out right only because the main link
    // happened to appear first, this order would break it.
    const quotedStatus = makeNode({ tag: 'A', href: '/other/status/222' });
    const quoted = makeNode({ is: ['div[role="link"][tabindex]'], children: [quotedStatus] });
    const mainStatus = makeNode({ tag: 'A', href: '/main/status/111' });
    const mainImg = makeNode({ tag: 'IMG', src: 'https://pbs.twimg.com/media/MAIN.jpg' });
    const article = makeNode({
      tag: 'ARTICLE',
      is: ['article[data-testid="tweet"]', 'article[role="article"]'],
      children: [quoted, mainStatus, mainImg],
    });
    const found = findTweetScope(mainImg);
    expect(found.scope).toBe(article);
    expect(statusIdInScope(found)).toBe('111');
  });
});

describe('imageInScope', () => {
  it('excludes quoted media from a main-tweet scope', () => {
    const t = quotedTweetTree();
    const mainScope = findTweetScope(t.mainImg);
    expect(imageInScope(t.mainImg, mainScope)).toBe(true);
    expect(imageInScope(t.quotedImg, mainScope)).toBe(false);
  });

  it('keeps quoted media when the scope is the quoted tweet', () => {
    const t = quotedTweetTree();
    const quotedScope = findTweetScope(t.quotedImg);
    expect(imageInScope(t.quotedImg, quotedScope)).toBe(true);
  });
});

describe('scopeHasVideo', () => {
  it('does not report a quoted tweet video for a main-tweet click', () => {
    const t = quotedTweetTree({ quotedVideo: true });
    expect(scopeHasVideo(findTweetScope(t.mainImg))).toBe(false);
  });

  it('does not report the main tweet video for a quoted-tweet click', () => {
    const t = quotedTweetTree({ mainVideo: true });
    expect(scopeHasVideo(findTweetScope(t.quotedImg))).toBe(false);
  });

  it('reports the quoted tweet video for a quoted-tweet click', () => {
    const t = quotedTweetTree({ quotedVideo: true });
    expect(scopeHasVideo(findTweetScope(t.quotedImg))).toBe(true);
  });

  it('reports the main tweet video for a main-tweet click', () => {
    const t = quotedTweetTree({ mainVideo: true });
    expect(scopeHasVideo(findTweetScope(t.mainImg))).toBe(true);
  });

  it('reports the main tweet video even when a quoted video precedes it in the DOM', () => {
    const quotedVid = makeNode({ tag: 'VIDEO' });
    const quoted = makeNode({ is: ['div[role="link"][tabindex]'], children: [quotedVid] });
    const mainVid = makeNode({ tag: 'VIDEO' });
    const article = makeNode({
      tag: 'ARTICLE',
      is: ['article[data-testid="tweet"]', 'article[role="article"]'],
      children: [quoted, mainVid],
    });
    const found = findTweetScope(mainVid);
    expect(found.scope).toBe(article);
    expect(found.isQuoted).toBe(false);
    expect(scopeHasVideo(found)).toBe(true);
  });
});
