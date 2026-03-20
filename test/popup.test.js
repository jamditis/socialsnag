import { describe, it, expect, vi } from 'vitest';
import { relativeTime } from '../src/popup.js';

describe('relativeTime', () => {
  it('returns "now" for less than 1 minute ago', () => {
    const ts = Date.now() - 30000; // 30 seconds ago
    expect(relativeTime(ts)).toBe('now');
  });

  it('returns "1m" at exactly 1 minute', () => {
    const ts = Date.now() - 60000;
    expect(relativeTime(ts)).toBe('1m');
  });

  it('returns minutes for less than 1 hour', () => {
    const ts = Date.now() - 45 * 60000; // 45 minutes ago
    expect(relativeTime(ts)).toBe('45m');
  });

  it('returns "1h" at exactly 1 hour', () => {
    const ts = Date.now() - 3600000;
    expect(relativeTime(ts)).toBe('1h');
  });

  it('returns hours for less than 24 hours', () => {
    const ts = Date.now() - 12 * 3600000; // 12 hours ago
    expect(relativeTime(ts)).toBe('12h');
  });

  it('returns "1d" at 24 hours', () => {
    const ts = Date.now() - 24 * 3600000;
    expect(relativeTime(ts)).toBe('1d');
  });

  it('returns days for more than 24 hours', () => {
    const ts = Date.now() - 72 * 3600000; // 3 days ago
    expect(relativeTime(ts)).toBe('3d');
  });
});
