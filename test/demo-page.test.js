import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const CWS_URL = 'https://chromewebstore.google.com/detail/socialsnag/llbpeneloehnlaomolbalbmhjncpmnfa';
const EXTENSION_ID = 'llbpeneloehnlaomolbalbmhjncpmnfa';

function loadDemo() {
  return import('../docs/demo.js');
}

class FakeElement {
  constructor({ hidden = false, textContent = '', valid = true, value = '' } = {}) {
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = false;
    this.hidden = hidden;
    this.listeners = new Map();
    this.textContent = textContent;
    this.value = value;
    this.checkValidity = vi.fn(() => valid);
    this.focus = vi.fn();
    this.reportValidity = vi.fn();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  trigger(type, event = {}) {
    return this.listeners.get(type)?.(event);
  }
}

function createFormElements(url = 'https://x.com/socialsnag/status/123', valid = true) {
  return {
    form: new FakeElement({ valid }),
    input: new FakeElement({ value: url }),
    button: new FakeElement({ textContent: 'Download media' }),
    status: new FakeElement(),
    statusTitle: new FakeElement({ textContent: 'Ready to download' }),
    statusDetail: new FakeElement({ textContent: 'Paste a direct post link to start.' }),
    installLink: new FakeElement({ hidden: true }),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('the web-page runtime request', () => {
  it('uses the published extension ID', async () => {
    const { EXTENSION_ID: publishedExtensionId } = await loadDemo();

    expect(publishedExtensionId).toBe(EXTENSION_ID);
  });

  it('sends the callback request with a trimmed URL', async () => {
    const { requestSubmittedUrl } = await loadDemo();
    const response = { ok: true, code: 'ok', platform: 'twitter', count: 1 };
    const runtime = {
      lastError: null,
      sendMessage: vi.fn((_id, _message, callback) => callback(response)),
    };

    await expect(requestSubmittedUrl('  https://x.com/socialsnag/status/123  ', {
      runtime,
      timeoutMs: 50,
    })).resolves.toEqual(response);
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      EXTENSION_ID,
      {
        action: 'downloadSubmittedUrl',
        url: 'https://x.com/socialsnag/status/123',
      },
      expect.any(Function),
    );
  });

  it('maps a missing runtime to the install or update state', async () => {
    const { requestSubmittedUrl } = await loadDemo();

    await expect(requestSubmittedUrl('https://x.com/socialsnag/status/123', {
      runtime: undefined,
    })).resolves.toMatchObject({ ok: false, code: 'extension_unavailable' });
  });

  it('maps runtime.lastError to the install or update state', async () => {
    const { requestSubmittedUrl } = await loadDemo();
    const runtime = {
      lastError: null,
      sendMessage: vi.fn((_id, _message, callback) => {
        runtime.lastError = { message: 'Receiving end does not exist.' };
        callback();
      }),
    };

    await expect(requestSubmittedUrl('https://x.com/socialsnag/status/123', {
      runtime,
      timeoutMs: 50,
    })).resolves.toMatchObject({ ok: false, code: 'extension_unavailable' });
  });

  it('maps an undefined response to the install or update state', async () => {
    const { requestSubmittedUrl } = await loadDemo();
    const runtime = {
      lastError: null,
      sendMessage: vi.fn((_id, _message, callback) => callback(undefined)),
    };

    await expect(requestSubmittedUrl('https://x.com/socialsnag/status/123', {
      runtime,
      timeoutMs: 50,
    })).resolves.toMatchObject({ ok: false, code: 'extension_unavailable' });
  });

  it('uses a 120-second default and maps a hard timeout to post resolution', async () => {
    vi.useFakeTimers();
    try {
      const { DEFAULT_REQUEST_TIMEOUT_MS, requestSubmittedUrl } = await loadDemo();
      const runtime = { lastError: null, sendMessage: vi.fn() };

      expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120_000);
      const result = requestSubmittedUrl('https://x.com/socialsnag/status/123', {
        runtime,
        timeoutMs: 20,
      });
      await vi.advanceTimersByTimeAsync(19);
      expect(runtime.sendMessage).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual({
        ok: false,
        code: 'resolution_timeout',
        platform: null,
        count: 0,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the timer when the callback wins so time cannot replace the result', async () => {
    vi.useFakeTimers();
    try {
      const { requestSubmittedUrl } = await loadDemo();
      const response = { ok: true, code: 'ok', platform: 'twitter', count: 1 };
      const runtime = {
        lastError: null,
        sendMessage: vi.fn((_id, _message, callback) => callback(response)),
      };

      const result = requestSubmittedUrl('https://x.com/socialsnag/status/123', {
        runtime,
        timeoutMs: 20,
      });
      await expect(result).resolves.toEqual(response);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(20);
      await expect(result).resolves.toEqual(response);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a callback that arrives after the hard timeout', async () => {
    vi.useFakeTimers();
    try {
      const { requestSubmittedUrl } = await loadDemo();
      let callback;
      const runtime = {
        lastError: null,
        sendMessage: vi.fn((_id, _message, sendResponse) => {
          callback = sendResponse;
        }),
      };
      const result = requestSubmittedUrl('https://x.com/socialsnag/status/123', {
        runtime,
        timeoutMs: 20,
      });

      await vi.advanceTimersByTimeAsync(20);
      const timedOut = await result;
      callback({ ok: true, code: 'ok', platform: 'twitter', count: 1 });

      await expect(result).resolves.toEqual(timedOut);
      expect(timedOut.code).toBe('resolution_timeout');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the first callback result when the runtime calls back twice', async () => {
    vi.useFakeTimers();
    try {
      const { requestSubmittedUrl } = await loadDemo();
      const first = { ok: true, code: 'ok', platform: 'facebook', count: 2 };
      const runtime = {
        lastError: null,
        sendMessage: vi.fn((_id, _message, callback) => {
          callback(first);
          callback({ ok: false, code: 'unexpected', platform: null, count: 0 });
        }),
      };

      const result = requestSubmittedUrl('https://facebook.com/user/posts/123', {
        runtime,
        timeoutMs: 20,
      });

      await expect(result).resolves.toEqual(first);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('response copy', () => {
  const cases = [
    ['invalid_url', 'Use a direct supported post link', 'error', false],
    ['unsupported_url', 'Use a direct supported post link', 'error', false],
    ['busy', 'SocialSnag is already working', 'working', false],
    ['platform_disabled', 'Enable X/Twitter in SocialSnag settings', 'error', false],
    ['auth_required', 'Log in to continue', 'error', false],
    ['rate_limited', 'Wait before retrying', 'error', false],
    ['access_or_unavailable', 'Media may be unavailable', 'error', false],
    ['no_media', 'Media may be unavailable', 'error', false],
    ['resolution_timeout', 'The post took too long', 'error', false],
    ['download_failed', 'Download failed', 'error', false],
    ['history_failed', 'Download started', 'success', false, 1],
    ['unexpected', 'SocialSnag could not start the download', 'error', false],
    ['invalid_sender', 'SocialSnag could not start the download', 'error', false],
    ['invalid_request', 'SocialSnag could not start the download', 'error', false],
    ['extension_unavailable', 'Install or update SocialSnag', 'error', true],
  ];

  it.each(cases)('maps %s to safe visible copy', async (
    code,
    title,
    tone,
    showInstallLink,
    count = 0,
  ) => {
    const { responseToViewModel } = await loadDemo();
    const view = responseToViewModel({ ok: false, code, platform: 'twitter', count });

    expect(view).toEqual({
      title,
      detail: expect.any(String),
      tone,
      showInstallLink,
    });
    expect(view.detail.length).toBeGreaterThan(0);
    expect(view.detail).not.toContain('<');
  });

  it('explains invalid and unsupported input with every supported platform', async () => {
    const { responseToViewModel } = await loadDemo();

    for (const code of ['invalid_url', 'unsupported_url']) {
      expect(responseToViewModel({ ok: false, code }).detail).toBe(
        'Paste a direct post link from Instagram, X/Twitter, Facebook, or Bluesky.',
      );
    }
  });

  it('does not claim a definite cause for access and no-media failures', async () => {
    const { responseToViewModel } = await loadDemo();
    const expected = 'You may be logged out, lack access, or the post may be private, expired, or deleted.';

    expect(responseToViewModel({ ok: false, code: 'access_or_unavailable' }).detail).toBe(expected);
    expect(responseToViewModel({ ok: false, code: 'no_media' }).detail).toBe(expected);
  });

  it('gives login, rate-limit, and timeout recovery guidance', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({ ok: false, code: 'auth_required' }).detail).toContain('Log in');
    expect(responseToViewModel({ ok: false, code: 'rate_limited' }).detail).toContain('Wait');
    expect(responseToViewModel({ ok: false, code: 'resolution_timeout' }).detail).toBe(
      'Open the post in this browser, make sure you are logged in, and retry.',
    );
  });

  it('tells the user to enable a disabled platform in SocialSnag settings', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({
      ok: false,
      code: 'platform_disabled',
      platform: 'instagram',
      count: 0,
    })).toEqual({
      title: 'Enable Instagram in SocialSnag settings',
      detail: 'Open SocialSnag settings, turn on Instagram, and retry.',
      tone: 'error',
      showInstallLink: false,
    });
  });

  it('distinguishes a history write problem from a media download failure', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({
      ok: false,
      code: 'history_failed',
      platform: 'facebook',
      count: 2,
    })).toEqual({
      title: 'Download started',
      detail: '2 files from Facebook are downloading, but SocialSnag could not update its download history.',
      tone: 'success',
      showInstallLink: false,
    });
    expect(responseToViewModel({
      ok: false,
      code: 'history_failed',
      platform: 'facebook',
      count: 0,
    }).title).toBe('SocialSnag could not start the download');
  });

  it('uses singular count and the public platform label on success', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({ ok: true, code: 'ok', platform: 'twitter', count: 1 })).toEqual({
      title: 'Download started',
      detail: '1 file from X/Twitter is downloading.',
      tone: 'success',
      showInstallLink: false,
    });
  });

  it('uses plural count and platform label on success', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({ ok: true, code: 'ok', platform: 'bluesky', count: 3 })).toEqual({
      title: 'Download started',
      detail: '3 files from Bluesky are downloading.',
      tone: 'success',
      showInstallLink: false,
    });
  });

  it.each([
    ['instagram', 'Instagram'],
    ['twitter', 'X/Twitter'],
    ['facebook', 'Facebook'],
    ['bluesky', 'Bluesky'],
  ])('accepts the own supported platform key %s', async (platform, label) => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({ ok: true, code: 'ok', platform, count: 1 }).detail).toBe(
      `1 file from ${label} is downloading.`,
    );
  });

  it.each([
    ['non-boolean ok', { ok: 'yes', code: 'ok', platform: 'instagram', count: 1 }],
    ['wrong code', { ok: true, code: 'done', platform: 'instagram', count: 1 }],
    ['unknown platform', { ok: true, code: 'ok', platform: 'unknown', count: 1 }],
    ['inherited platform name', { ok: true, code: 'ok', platform: 'toString', count: 1 }],
    ['zero count', { ok: true, code: 'ok', platform: 'instagram', count: 0 }],
    ['count above the cap', { ok: true, code: 'ok', platform: 'instagram', count: 21 }],
    ['fractional count', { ok: true, code: 'ok', platform: 'instagram', count: 1.5 }],
  ])('maps an invalid success shape to a generic failure: %s', async (_label, response) => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel(response)).toEqual({
      title: 'SocialSnag could not start the download',
      detail: 'Check the link and retry. If the problem continues, update SocialSnag.',
      tone: 'error',
      showInstallLink: false,
    });
  });

  it('includes the successful count in a partial download failure', async () => {
    const { responseToViewModel } = await loadDemo();

    expect(responseToViewModel({
      ok: false,
      code: 'download_failed',
      platform: 'facebook',
      count: 1,
    })).toEqual({
      title: 'Some downloads failed',
      detail: '1 file from Facebook started, but the remaining media could not be downloaded.',
      tone: 'error',
      showInstallLink: false,
    });
  });
});

describe('the form controller', () => {
  it.each([
    ['empty', ''],
    ['malformed', 'not a URL'],
  ])('uses native validation and does not send an %s value', async (_label, url) => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements(url, false);
    const request = vi.fn();
    setupDemoForm({ ...elements, request });

    await elements.form.trigger('submit', { preventDefault: vi.fn() });

    expect(elements.form.checkValidity).toHaveBeenCalledOnce();
    expect(elements.form.reportValidity).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(elements.statusTitle.textContent).toBe('Use a direct supported post link');
    expect(elements.status.hidden).toBe(false);
  });

  it('keeps the direct-link status visible when native validation blocks submit', async () => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements('not a URL', false);
    const request = vi.fn();
    setupDemoForm({ ...elements, request });

    elements.input.trigger('invalid');

    expect(request).not.toHaveBeenCalled();
    expect(elements.statusTitle.textContent).toBe('Use a direct supported post link');
    expect(elements.statusDetail.textContent).toContain('Instagram');
    expect(elements.status.hidden).toBe(false);
  });

  it('prevents double submission, disables controls, and restores them after the result', async () => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements('  https://x.com/socialsnag/status/123  ');
    const requestResult = deferred();
    const request = vi.fn(() => requestResult.promise);
    setupDemoForm({ ...elements, request });
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };

    const firstSubmit = elements.form.trigger('submit', firstEvent);
    const secondSubmit = elements.form.trigger('submit', secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('https://x.com/socialsnag/status/123');
    expect(elements.input.value).toBe('https://x.com/socialsnag/status/123');
    expect(elements.input.disabled).toBe(true);
    expect(elements.button.disabled).toBe(true);
    expect(elements.button.textContent).toBe('Working');
    expect(elements.form.getAttribute('aria-busy')).toBe('true');

    requestResult.resolve({ ok: true, code: 'ok', platform: 'twitter', count: 1 });
    await firstSubmit;
    await secondSubmit;

    expect(elements.input.disabled).toBe(false);
    expect(elements.button.disabled).toBe(false);
    expect(elements.button.textContent).toBe('Download media');
    expect(elements.form.getAttribute('aria-busy')).toBeNull();
  });

  it('renders results with textContent, keeps the status visible, and focuses it', async () => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements();
    const request = vi.fn().mockResolvedValue({
      ok: false,
      code: 'access_or_unavailable',
      platform: 'twitter',
      count: 0,
    });
    setupDemoForm({ ...elements, request });

    await elements.form.trigger('submit', { preventDefault: vi.fn() });

    expect(elements.statusTitle.textContent).toBe('Media may be unavailable');
    expect(elements.statusDetail.textContent).toBe(
      'You may be logged out, lack access, or the post may be private, expired, or deleted.',
    );
    expect(elements.status.dataset.tone).toBe('error');
    expect(elements.status.hidden).toBe(false);
    expect(elements.status.focus).toHaveBeenCalledOnce();
    expect(elements.installLink.hidden).toBe(true);
  });

  it('shows the Chrome Web Store link only for the install or update state', async () => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements();
    setupDemoForm({
      ...elements,
      request: vi.fn().mockResolvedValue({ ok: false, code: 'extension_unavailable' }),
    });

    await elements.form.trigger('submit', { preventDefault: vi.fn() });

    expect(elements.statusTitle.textContent).toBe('Install or update SocialSnag');
    expect(elements.installLink.hidden).toBe(false);
  });

  it('turns an unexpected request rejection into a visible safe result', async () => {
    const { setupDemoForm } = await loadDemo();
    const elements = createFormElements();
    setupDemoForm({
      ...elements,
      request: vi.fn().mockRejectedValue(new Error('private URL details')),
    });

    await elements.form.trigger('submit', { preventDefault: vi.fn() });

    expect(elements.statusTitle.textContent).toBe('SocialSnag could not start the download');
    expect(elements.statusDetail.textContent).not.toContain('private URL details');
    expect(elements.status.focus).toHaveBeenCalledOnce();
    expect(elements.button.disabled).toBe(false);
  });
});

describe('the landing-page markup', () => {
  it('places the semantic URL form in the hero before the badges', () => {
    const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
    const heroTextIndex = html.indexOf('<div class="hero-text">');
    const formIndex = html.indexOf('id="url-demo-form"', heroTextIndex);
    const badgesIndex = html.indexOf('<div class="hero-badges">', heroTextIndex);

    expect(heroTextIndex).toBeGreaterThan(-1);
    expect(formIndex).toBeGreaterThan(heroTextIndex);
    expect(formIndex).toBeLessThan(badgesIndex);
    expect(html).toMatch(/<label[^>]+for="submitted-post-url"[^>]*>Paste a post link<\/label>/);
    expect(html).toMatch(/<input[^>]+id="submitted-post-url"[^>]+type="url"/);
    const submittedInput = html.match(/<input[\s\S]*?id="submitted-post-url"[\s\S]*?>/)?.[0];
    expect(submittedInput).not.toMatch(/\sname=/);
    expect(html).toMatch(/<button[^>]+type="submit"[^>]*>Download media<\/button>/);
    expect(html).toMatch(/id="demo-status"[^>]+role="status"[^>]+aria-live="polite"[^>]+tabindex="-1"/);
    expect(html).toContain(CWS_URL);
    expect(html).toContain('<script type="module" src="demo.js"></script>');
    expect(html).not.toContain('novalidate');
    expect(html).not.toContain('Your submitted URL stays on this device');
    expect(html).toContain('never to a SocialSnag or developer-operated server');
  });

  it('uses text-only rendering and never logs a submitted URL', async () => {
    await expect(loadDemo()).resolves.toBeDefined();
    const source = readFileSync(new URL('../docs/demo.js', import.meta.url), 'utf8');

    expect(source).toContain('textContent');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toMatch(/console\s*\./);
  });
});

describe('the privacy copy contract', () => {
  it('states the browser, platform, storage, and developer-server boundaries', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const policy = readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
    const privacyPage = readFileSync(new URL('../docs/privacy.html', import.meta.url), 'utf8');
    const optionsPage = readFileSync(new URL('../src/options.html', import.meta.url), 'utf8');

    for (const source of [policy, privacyPage]) {
      expect(source).not.toContain('held only long enough');
      expect(source).toContain('remains visible in the form');
      expect(source).toContain('browser cache and history');
      expect(source).toContain('temporary inactive browser tab');
      expect(source).toContain('Chrome download ID');
      expect(source).toContain('chrome.storage.session');
      expect(source).toContain('request type');
    }

    expect(readme).not.toContain('does not collect analytics, telemetry, or personal information');
    expect(readme).toContain('no analytics scripts or remote logging');
    expect(optionsPage).not.toContain('publicly accessible media');
    expect(optionsPage).not.toContain('No data is collected or transmitted');
    expect(optionsPage).toContain('selected social platforms and media hosts');
    expect(optionsPage).toContain('developer-operated server');
  });
});
