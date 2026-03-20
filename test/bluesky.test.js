import { describe, it, expect } from 'vitest';
import {
  upgradeImageUrl,
  extractPostId,
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
