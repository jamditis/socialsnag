import { describe, it, expect, beforeAll } from 'vitest';

// The resolver only wires its contextmenu and message listeners when a document
// exists, and this suite runs in node. A stand-in document that records the
// contextmenu listener is enough to drive the wiring the way a page does.
const pageListeners = {};
let listener;

beforeAll(async () => {
  globalThis.document = {
    body: null,
    addEventListener: (type, fn) => { pageListeners[type] = fn; },
  };
  const before = globalThis.chrome.runtime.onMessage._listeners.length;
  await import('../src/platforms/linkedin.js');
  listener = globalThis.chrome.runtime.onMessage._listeners[before];
  return () => { delete globalThis.document; };
});

const send = (message) => new Promise((resolve) => {
  listener({ action: 'resolve', ...message }, {}, resolve);
});

// A clicked element with no media and no post around it.
const bareElement = {
  tagName: 'DIV',
  src: '',
  parentElement: null,
  matches: () => false,
  querySelector: () => null,
  closest: () => null,
};

// Order matters: the first two cases run before any contextmenu event, which is
// the state a resolver injected after the click is in (issue #64).
describe('linkedin resolve message', () => {
  it('says it had no clicked element instead of returning a bare empty list', async () => {
    const response = await send({ type: 'all', srcUrl: '' });
    expect(response).toEqual({ urls: [], platform: 'linkedin', reason: 'no-target' });
  });

  it('still resolves a single image from srcUrl without a clicked element', async () => {
    globalThis.window = { location: { href: 'https://www.linkedin.com/feed/' } };
    try {
      const src = 'https://media.licdn.com/dms/image/v2/abc/feedshare-shrink_800/0/1?e=1&v=beta&t=x';
      const response = await send({ type: 'single', srcUrl: src });
      expect(response.urls.map((u) => u.url)).toEqual([src]);
      expect(response.reason).toBeUndefined();
    } finally {
      delete globalThis.window;
    }
  });

  it('does not flag an empty result once a right-click was seen', async () => {
    pageListeners.contextmenu({ target: bareElement });
    const response = await send({ type: 'all', srcUrl: '' });
    expect(response).toEqual({ urls: [], platform: 'linkedin' });
  });
});
