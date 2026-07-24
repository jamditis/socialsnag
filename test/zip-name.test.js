import { describe, it, expect } from 'vitest';
import { packageZipSlug, zipFileName } from '../zip-name.js';

describe('packageZipSlug', () => {
  it('leaves an unscoped name unchanged', () => {
    expect(packageZipSlug('socialsnag')).toBe('socialsnag');
  });

  it('strips a leading @scope/ from a scoped name', () => {
    expect(packageZipSlug('@org/ext')).toBe('ext');
  });

  it('flattens any remaining path separators', () => {
    // Defensive: a name with an interior slash (or a Windows-style backslash)
    // must still resolve to one flat segment, not a nested path.
    expect(packageZipSlug('@org/nested/ext')).toBe('nested-ext');
    expect(packageZipSlug('@org/a/b/c')).toBe('a-b-c');
    expect(packageZipSlug('a\\b')).toBe('a-b');
  });
});

describe('zipFileName', () => {
  it('builds <slug>-<version>.zip for a scoped name', () => {
    expect(zipFileName('@org/ext', '1.0.0')).toBe('ext-1.0.0.zip');
  });

  it('builds <name>-<version>.zip for an unscoped name', () => {
    expect(zipFileName('socialsnag', '1.2.1')).toBe('socialsnag-1.2.1.zip');
  });
});
