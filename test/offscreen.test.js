import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
