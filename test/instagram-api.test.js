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
