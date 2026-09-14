import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((child) => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
}

let elements;
let ready;
async function openPopup() {
  await import('../src/popup.js');
  await ready();
}
function labels() { return elements['status-grid'].children.map((row) => row.textContent); }

beforeEach(() => {
  vi.resetModules();
  chrome.storage.sync._reset();
  chrome.storage.local._reset();
  chrome.permissions.onAdded._listeners.length = 0;
  chrome.permissions.onRemoved._listeners.length = 0;
  elements = Object.fromEntries(['status-grid', 'history-list', 'version', 'open-settings', 'clear-history']
    .map((name) => [name, new Element('div')]));
  vi.stubGlobal('document', {
    getElementById: (id) => elements[id],
    querySelector: () => elements.version,
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') ready = fn; },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('optional platform popup status', () => {
  it('shows LinkedIn only with the complete live grant and includes its history icon', async () => {
    const contains = vi.spyOn(chrome.permissions, 'contains').mockResolvedValue(true);
    await chrome.storage.sync.set({ platform_linkedin: false });
    await chrome.storage.local.set({ downloadHistory: [{ platform: 'linkedin', timestamp: Date.now() }] });
    await openPopup();
    expect(contains).toHaveBeenCalledWith({ origins: ['*://*.linkedin.com/*', '*://*.media.licdn.com/*'] });
    expect(labels()).toEqual(['Instagram', 'Twitter/X', 'Facebook', 'Bluesky', 'LinkedIn']);
    expect(elements['history-list'].children[0].children[0].children[0].tagName).toBe('svg');
    expect(elements['status-grid'].children[4].className).toBe('status-item');
  });

  it('ignores stale preferences and removes the row on permission revocation', async () => {
    const contains = vi.spyOn(chrome.permissions, 'contains').mockResolvedValue(true);
    await openPopup();
    contains.mockResolvedValue(false);
    await chrome.storage.sync.set({ platform_linkedin: true });
    await Promise.all(chrome.permissions.onRemoved._listeners.map((fn) => fn({ origins: ['*://*.media.licdn.com/*'] })));
    expect(labels()).not.toContain('LinkedIn');
    expect(chrome.permissions.onRemoved._listeners.length).toBeGreaterThan(0);
  });

  it('does not repaint a stale grant over a newer revocation', async () => {
    const contains = vi.spyOn(chrome.permissions, 'contains').mockResolvedValue(false);
    await openPopup();
    let releaseGrant;
    contains.mockImplementationOnce(() => new Promise((resolve) => { releaseGrant = resolve; }));
    const oldRender = chrome.permissions.onAdded._listeners[0]({});
    await vi.waitFor(() => expect(releaseGrant).toBeTypeOf('function'));
    await chrome.permissions.onRemoved._listeners[0]({});
    releaseGrant(true);
    await oldRender;
    expect(labels()).not.toContain('LinkedIn');
  });

  it('keeps core status and history when the optional permission check fails', async () => {
    vi.spyOn(chrome.permissions, 'contains').mockRejectedValue(new Error('unavailable'));
    await openPopup();
    expect(labels()).toHaveLength(4);
    expect(elements['history-list'].children[0].className).toBe('empty-state');
  });

  it('omits a never-granted or partial-granted platform and keeps core disabled rows', async () => {
    vi.spyOn(chrome.permissions, 'contains').mockResolvedValue(false);
    await chrome.storage.sync.set({ platform_facebook: false, platform_linkedin: true });
    await openPopup();
    expect(labels()).toEqual(['Instagram', 'Twitter/X', 'Facebook', 'Bluesky']);
    expect(elements['status-grid'].children[2].className).toContain('disabled');
  });
});
