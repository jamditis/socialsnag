import { describe, it, expect } from 'vitest';
import { upgradeUrl, extractPostId } from '../src/platforms/linkedin.js';

describe('upgradeUrl', () => {
  it('returns null for null input', () => {
    expect(upgradeUrl(null)).toBeNull();
  });

  it('returns null for a non-licdn URL', () => {
    expect(upgradeUrl('https://example.com/photo.jpg')).toBeNull();
  });

  it('drops a /shrink_<w>_<h>/ size segment to get the full-size original', () => {
    const url = 'https://media.licdn.com/dms/image/v2/D4E22/shrink_800_800/photo.jpg';
    const result = upgradeUrl(url);
    expect(result).toBe('https://media.licdn.com/dms/image/v2/D4E22/photo.jpg');
    expect(result).not.toContain('shrink_');
  });

  it('returns the URL unchanged when there is no shrink segment', () => {
    const url = 'https://media.licdn.com/dms/image/v2/D4E22/photo.jpg';
    expect(upgradeUrl(url)).toBe(url);
  });

  it('handles asymmetric width/height in the shrink segment', () => {
    const url = 'https://media.licdn.com/dms/image/shrink_1280_720/clip.jpg';
    expect(upgradeUrl(url)).toBe('https://media.licdn.com/dms/image/clip.jpg');
  });

  it('matches the licdn host regardless of subdomain prefix', () => {
    const url = 'https://static.media.licdn.com/shrink_200_200/x.png';
    expect(upgradeUrl(url)).toBe('https://static.media.licdn.com/x.png');
  });
});

describe('extractPostId', () => {
  it('returns null for empty or null input', () => {
    expect(extractPostId('')).toBeNull();
    expect(extractPostId(null)).toBeNull();
  });

  it('extracts the id from an activity-<n> post permalink', () => {
    const href = 'https://www.linkedin.com/posts/jane-doe_some-slug-activity-7012345678901234567-abCd/';
    expect(extractPostId(href)).toBe('7012345678901234567');
  });

  it('extracts the id from a urn:li:activity:<n> feed update', () => {
    const href = 'https://www.linkedin.com/feed/update/urn:li:activity:7099999999999999999';
    expect(extractPostId(href)).toBe('7099999999999999999');
  });

  it('returns null when no activity id is present', () => {
    expect(extractPostId('https://www.linkedin.com/in/jane-doe/')).toBeNull();
  });

  it('prefers the activity-<n> permalink form when both could match', () => {
    // The activity-(\d+) pattern is tried before the urn form.
    expect(extractPostId('activity-111 urn:li:activity:222')).toBe('111');
  });
});
