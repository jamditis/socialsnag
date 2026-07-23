import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  extractPostId,
  resolvePage,
  resolveContentMessage,
} from '../src/platforms/bluesky.js';

describe('upgradeImageUrl', () => {
  it('upgrades feed_thumbnail to feed_fullsize', () => {
    const url = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc123/bafkreixyz@jpeg';
    const result = upgradeImageUrl(url);
    expect(result).toBe('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/bafkreixyz@jpeg');
  });

  it('upgrades avatar_thumbnail to avatar', () => {
    const url = 'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abc123/bafkreixyz@jpeg';
    const result = upgradeImageUrl(url);
    expect(result).toBe('https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkreixyz@jpeg');
  });

  it('returns feed_fullsize URL unchanged', () => {
    const url = 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc123/bafkreixyz@jpeg';
    expect(upgradeImageUrl(url)).toBe(url);
  });

  it('returns other cdn.bsky.app URLs unchanged', () => {
    const url = 'https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkreixyz@jpeg';
    expect(upgradeImageUrl(url)).toBe(url);
  });

  it('returns null for non-bsky URL', () => {
    expect(upgradeImageUrl('https://example.com/image.jpg')).toBeNull();
  });

  it('returns null when cdn.bsky.app appears only in the query, not the host', () => {
    expect(upgradeImageUrl('https://evil.com/?u=https://cdn.bsky.app/img/x.jpg')).toBeNull();
  });

  it('returns null for a dot-boundary lookalike host', () => {
    expect(upgradeImageUrl('https://cdn.bsky.app.evil.com/x.jpg')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(upgradeImageUrl(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(upgradeImageUrl(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(upgradeImageUrl('')).toBeNull();
  });
});

describe('extractPostId', () => {
  it('extracts rkey from a standard post URL', () => {
    expect(extractPostId('/profile/user.bsky.social/post/3labc123xyz')).toBe('3labc123xyz');
  });

  it('extracts rkey from a DID-based profile URL', () => {
    expect(extractPostId('/profile/did:plc:abc123/post/3lxyz789')).toBe('3lxyz789');
  });

  it('returns null for a profile URL without a post', () => {
    expect(extractPostId('/profile/user.bsky.social')).toBeNull();
  });

  it('returns null for non-post URL', () => {
    expect(extractPostId('/settings/account')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractPostId(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPostId('')).toBeNull();
  });
});

describe('resolvePage', () => {
  const makePost = (
    postId,
    did = 'did:plc:abc',
    account = 'alice.bsky.social',
  ) => {
    const media = {
      src: `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${postId}@jpeg`,
    };
    const permalink = { href: `/profile/${account}/post/${postId}` };
    return {
      matches: (selector) => selector === '[data-testid^="postThreadItem-by-"]',
      parentElement: null,
      querySelectorAll: (selector) => {
        if (selector === 'img[src*="cdn.bsky.app"]') return [media];
        if (selector === 'a[href*="/post/"]') return [permalink];
        return [];
      },
    };
  };

  it('resolves the direct post without a right-click target', async () => {
    const post = makePost('3labc123xyz');
    const root = { querySelectorAll: () => [post] };

    const items = await resolvePage(
      root,
      'https://bsky.app/profile/alice.bsky.social/post/3labc123xyz',
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/3labc123xyz@jpeg',
      filename: 'post_3labc123xyz_1',
    });
  });

  it('handles a resolvePage message without a stored right-click target', async () => {
    const post = makePost('3labc123xyz');
    const root = { querySelectorAll: () => [post] };

    const items = await resolveContentMessage(
      {
        action: 'resolvePage',
        pageUrl: 'https://bsky.app/profile/alice.bsky.social/post/3labc123xyz',
      },
      null,
      root,
    );

    expect(items).toHaveLength(1);
    expect(items[0].filename).toBe('post_3labc123xyz_1');
  });

  it('does not select an unrelated feed item on a direct post page', async () => {
    const media = {
      src: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:other/bafk@jpeg',
    };
    const feedItem = {
      matches: (selector) => selector === '[data-testid^="feedItem-by-"]',
      parentElement: null,
      querySelectorAll: (selector) => selector.includes('cdn.bsky.app') ? [media] : [],
    };
    const root = {
      querySelectorAll: (selector) => selector.includes('feedItem') ? [feedItem] : [],
    };

    expect(await resolvePage(
      root,
      'https://bsky.app/profile/alice.bsky.social/post/3labc123xyz',
    )).toEqual([]);
  });

  it('chooses the thread item whose permalink matches the submitted post URL', async () => {
    const unrelated = makePost('3lunrelated', 'did:plc:other');
    const requested = makePost('3lrequested', 'did:plc:requested');
    const root = { querySelectorAll: () => [unrelated, requested] };

    const items = await resolvePage(
      root,
      'https://bsky.app/profile/alice.bsky.social/post/3lrequested',
    );

    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('3lrequested@jpeg');
    expect(items[0].url).not.toContain('3lunrelated@jpeg');
  });

  it('matches a DID submission to the rendered handle by stable post id', async () => {
    const unrelated = makePost('3lunrelated', 'did:plc:other', 'other.bsky.social');
    const requested = makePost('3lrequested', 'did:plc:requested');
    const root = { querySelectorAll: () => [unrelated, requested] };

    const items = await resolvePage(
      root,
      'https://bsky.app/profile/did:plc:requested/post/3lrequested',
    );

    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('3lrequested@jpeg');
    expect(items[0].url).not.toContain('3lunrelated@jpeg');
  });

  it('keeps handle submissions anchored to both account and post id', async () => {
    const sameIdOtherAccount = makePost(
      '3lshared',
      'did:plc:other',
      'other.bsky.social',
    );
    const requested = makePost('3lshared', 'did:plc:requested');
    const root = { querySelectorAll: () => [sameIdOtherAccount, requested] };

    const items = await resolvePage(
      root,
      'https://bsky.app/profile/alice.bsky.social/post/3lshared',
    );

    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('did:plc:requested');
    expect(items[0].url).not.toContain('did:plc:other');
  });

  it('returns no media for a DID submission without its stable post id', async () => {
    const unrelated = makePost('3lunrelated');
    const root = { querySelectorAll: () => [unrelated] };

    expect(await resolvePage(
      root,
      'https://bsky.app/profile/did:plc:requested/post/3lmissing',
    )).toEqual([]);
  });

  it('returns no media when no thread item proves the submitted post id', async () => {
    const unrelated = makePost('3lunrelated');
    const root = { querySelectorAll: () => [unrelated] };

    expect(await resolvePage(
      root,
      'https://bsky.app/profile/alice.bsky.social/post/3lmissing',
    )).toEqual([]);
  });
});
