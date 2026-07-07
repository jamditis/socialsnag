import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureOffscreen, copyViaOffscreen, zipViaOffscreen } from '../src/offscreen-host.js';

describe('ensureOffscreen', () => {
  beforeEach(() => {
    globalThis.chrome.runtime.getContexts = vi.fn().mockResolvedValue([]);
    globalThis.chrome.offscreen.createDocument = vi.fn().mockResolvedValue();
  });
  it('creates the document when none exists', async () => {
    await ensureOffscreen();
    expect(globalThis.chrome.offscreen.createDocument).toHaveBeenCalledOnce();
  });
  it('does not create a second document when one exists', async () => {
    globalThis.chrome.runtime.getContexts = vi.fn().mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
    await ensureOffscreen();
    expect(globalThis.chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });
});

describe('copyViaOffscreen', () => {
  it('ensures the doc and posts a clipboard message', async () => {
    globalThis.chrome.runtime.getContexts = vi.fn().mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
    const sent = [];
    globalThis.chrome.runtime.sendMessage = (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); };
    await copyViaOffscreen('https://cdn.example/x.jpg');
    expect(sent[0]).toMatchObject({ target: 'offscreen', action: 'clipboard', text: 'https://cdn.example/x.jpg' });
  });
});

describe('zipViaOffscreen', () => {
  beforeEach(() => {
    // Doc already exists so ensureOffscreen is a no-op.
    globalThis.chrome.runtime.getContexts = vi.fn().mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
  });
  it('returns null when the offscreen build fails', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
    expect(await zipViaOffscreen([{ name: 'a.jpg', url: 'https://cdn.example/a.jpg' }])).toBeNull();
  });
  it('returns the blob url when the build succeeds', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: true, url: 'blob:abc' });
    expect(await zipViaOffscreen([{ name: 'a.jpg', url: 'https://cdn.example/a.jpg' }])).toBe('blob:abc');
  });
});
