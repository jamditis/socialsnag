import { describe, it, expect } from 'vitest';
import {
  upgradeUrl,
  extractPhotoId,
  extractVideoUrlFromScripts,
} from '../src/platforms/facebook.js';

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
