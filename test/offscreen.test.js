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
  // The clipboard path uses a hidden textarea + document.execCommand('copy'),
  // which the async Clipboard API can't do from an unfocused offscreen document.
  // The node test env has no document, so stub the minimum the path touches.
  let execCommand;
  let lastTextarea;
  let originalDocument;
  beforeEach(() => {
    execCommand = vi.fn(() => true);
    lastTextarea = null;
    originalDocument = globalThis.document;
    globalThis.document = {
      createElement: () => {
        lastTextarea = { value: '', style: {}, select: vi.fn() };
        return lastTextarea;
      },
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    };
  });
  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('rejects a message from a foreign sender', () => {
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'x' },
      { id: 'someone-else' },
      vi.fn(),
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('rejects a message from a tab context even with the right id', () => {
    // A content script shares the extension id; sender.tab marks it as page-side.
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'x' },
      { id: OWN_ID, tab: { id: 7 } },
      vi.fn(),
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('ignores a message aimed at a different target', () => {
    listener(
      { target: 'other', action: 'clipboard', text: 'x' },
      { id: OWN_ID },
      vi.fn(),
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('copies via execCommand for a valid clipboard message', () => {
    const sendResponse = vi.fn();
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'https://cdn.example/x.jpg' },
      { id: OWN_ID },
      sendResponse,
    );
    expect(lastTextarea.value).toBe('https://cdn.example/x.jpg');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('reports failure when the copy command is rejected', () => {
    execCommand.mockReturnValue(false);
    const sendResponse = vi.fn();
    listener(
      { target: 'offscreen', action: 'clipboard', text: 'x' },
      { id: OWN_ID },
      sendResponse,
    );
    expect(sendResponse.mock.calls[0][0].ok).toBe(false);
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
