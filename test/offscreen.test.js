import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Stub client-zip so the zip tests exercise the fetch/response logic, not the
// archive internals. downloadZip(inputs).blob() resolves to a placeholder blob.
vi.mock('client-zip', () => ({
  downloadZip: () => ({ blob: async () => new Blob(['zip']) }),
}));
// Importing the module registers its onMessage listener through the chrome mock.
import '../src/offscreen.js';

// The listener is registered at import time; grab it the same way the
// background tests reach contextMenus.onClicked._listeners[0].
const listener = globalThis.chrome.runtime.onMessage._listeners[0];

// chrome.runtime.id in the mock is 'test-extension-id'.
const OWN_ID = 'test-extension-id';

describe('offscreen onMessage listener', () => {
  let originalWriteText;
  beforeEach(() => {
    originalWriteText = globalThis.navigator.clipboard.writeText;
    globalThis.navigator.clipboard.writeText = vi.fn().mockResolvedValue();
  });
  afterEach(() => {
    globalThis.navigator.clipboard.writeText = originalWriteText;
  });

  it('rejects a message from a foreign sender', () => {
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'x' },
      { id: 'someone-else' },
      vi.fn(),
    );
    expect(globalThis.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('ignores a message aimed at a different target', () => {
    listener(
      { target: 'other', action: 'clipboard', text: 'x' },
      { id: OWN_ID },
      vi.fn(),
    );
    expect(globalThis.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('writes the clipboard for a valid clipboard message', () => {
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'https://cdn.example/x.jpg' },
      { id: OWN_ID },
      vi.fn(),
    );
    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith('https://cdn.example/x.jpg');
  });
});

describe('offscreen zip build', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const files = [{ name: 'a.jpg', url: 'u1' }, { name: 'b.jpg', url: 'u2' }];

  it('fails the zip when any file cannot be fetched (caller then falls back to per-file)', async () => {
    globalThis.fetch = vi.fn((url) => Promise.resolve({ ok: url === 'u1' }));
    const sendResponse = vi.fn();
    listener({ target: 'offscreen', action: 'zip', files }, { id: OWN_ID }, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0].ok).toBe(false);
    expect(sendResponse.mock.calls[0][0].error).toContain('1 of 2');
  });

  it('builds the zip and reports the fetched count when every file succeeds', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    const sendResponse = vi.fn();
    listener({ target: 'offscreen', action: 'zip', files }, { id: OWN_ID }, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0][0]).toMatchObject({ ok: true, count: 2 });
    expect(sendResponse.mock.calls[0][0].url).toBeTruthy();
    // Cookies must be sent so authenticated-only media (stories) can be fetched.
    expect(globalThis.fetch).toHaveBeenCalledWith('u1', { credentials: 'include' });
  });
});
