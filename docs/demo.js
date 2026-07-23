export const EXTENSION_ID = 'llbpeneloehnlaomolbalbmhjncpmnfa';
// This leaves room for bounded DID, tab, resolver, and filename work.
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const EXTENSION_UNAVAILABLE = {
  ok: false,
  code: 'extension_unavailable',
  platform: null,
  count: 0,
};

const REQUEST_TIMED_OUT = {
  ok: false,
  code: 'resolution_timeout',
  platform: null,
  count: 0,
};

const PLATFORM_LABELS = {
  instagram: 'Instagram',
  twitter: 'X/Twitter',
  facebook: 'Facebook',
  bluesky: 'Bluesky',
};

const GENERIC_FAILURE = {
  title: 'SocialSnag could not start the download',
  detail: 'Check the link and retry. If the problem continues, update SocialSnag.',
  tone: 'error',
  showInstallLink: false,
};

function fileCount(count) {
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  return `${safeCount} ${safeCount === 1 ? 'file' : 'files'}`;
}

function platformLabel(platform) {
  return Object.hasOwn(PLATFORM_LABELS, platform)
    ? PLATFORM_LABELS[platform]
    : 'the supported platform';
}

export function responseToViewModel(response) {
  if (!response) {
    return responseToViewModel(EXTENSION_UNAVAILABLE);
  }

  const count = Number.isInteger(response.count) && response.count > 0 ? response.count : 0;
  const platform = platformLabel(response.platform);

  const isValidSuccess = response.ok === true
    && response.code === 'ok'
    && Object.hasOwn(PLATFORM_LABELS, response.platform)
    && Number.isInteger(response.count)
    && response.count >= 1
    && response.count <= 20;

  if (isValidSuccess) {
    return {
      title: 'Download started',
      detail: `${fileCount(count)} from ${platform} ${count === 1 ? 'is' : 'are'} downloading.`,
      tone: 'success',
      showInstallLink: false,
    };
  }

  switch (response.code) {
    case 'invalid_url':
    case 'unsupported_url':
      return {
        title: 'Use a direct supported post link',
        detail: 'Paste a direct post link from Instagram, X/Twitter, Facebook, or Bluesky.',
        tone: 'error',
        showInstallLink: false,
      };
    case 'busy':
      return {
        title: 'SocialSnag is already working',
        detail: 'Wait for the current download to finish, then retry.',
        tone: 'working',
        showInstallLink: false,
      };
    case 'platform_disabled':
      return {
        title: `Enable ${platform} in SocialSnag settings`,
        detail: `Open SocialSnag settings, turn on ${platform}, and retry.`,
        tone: 'error',
        showInstallLink: false,
      };
    case 'auth_required':
      return {
        title: 'Log in to continue',
        detail: 'Log in to the platform in this browser, open the post, and retry.',
        tone: 'error',
        showInstallLink: false,
      };
    case 'rate_limited':
      return {
        title: 'Wait before retrying',
        detail: 'The platform is limiting requests. Wait a few minutes, then retry.',
        tone: 'error',
        showInstallLink: false,
      };
    case 'access_or_unavailable':
    case 'no_media':
      return {
        title: 'Media may be unavailable',
        detail: 'You may be logged out, lack access, or the post may be private, expired, or deleted.',
        tone: 'error',
        showInstallLink: false,
      };
    case 'resolution_timeout':
      return {
        title: 'The post took too long',
        detail: 'Open the post in this browser, make sure you are logged in, and retry.',
        tone: 'error',
        showInstallLink: false,
      };
    case 'download_failed':
      if (count > 0) {
        return {
          title: 'Some downloads failed',
          detail: `${fileCount(count)} from ${platform} started, but the remaining media could not be downloaded.`,
          tone: 'error',
          showInstallLink: false,
        };
      }
      return {
        title: 'Download failed',
        detail: `SocialSnag could not download media from ${platform}. Open the post and retry.`,
        tone: 'error',
        showInstallLink: false,
      };
    case 'history_failed':
      if (!Object.hasOwn(PLATFORM_LABELS, response.platform)
          || !Number.isInteger(response.count)
          || response.count < 1
          || response.count > 20) {
        return { ...GENERIC_FAILURE };
      }
      return {
        title: 'Download started',
        detail: `${fileCount(count)} from ${platform} ${count === 1 ? 'is' : 'are'} downloading, but SocialSnag could not update its download history.`,
        tone: 'success',
        showInstallLink: false,
      };
    case 'extension_unavailable':
      return {
        title: 'Install or update SocialSnag',
        detail: 'The current SocialSnag extension is required to download from this page.',
        tone: 'error',
        showInstallLink: true,
      };
    case 'unexpected':
    case 'invalid_sender':
    case 'invalid_request':
    default:
      return { ...GENERIC_FAILURE };
  }
}

export function requestSubmittedUrl(rawUrl, {
  runtime = globalThis.chrome?.runtime,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof runtime?.sendMessage !== 'function') {
    return Promise.resolve({ ...EXTENSION_UNAVAILABLE });
  }

  const url = String(rawUrl ?? '').trim();
  const requestTimeout = Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const timer = setTimeout(() => finish({ ...REQUEST_TIMED_OUT }), requestTimeout);

    try {
      runtime.sendMessage(
        EXTENSION_ID,
        { action: 'downloadSubmittedUrl', url },
        (response) => {
          if (runtime.lastError || response === undefined) {
            finish({ ...EXTENSION_UNAVAILABLE });
            return;
          }
          finish(response);
        },
      );
    } catch {
      finish({ ...EXTENSION_UNAVAILABLE });
    }
  });
}

function renderStatus({ status, statusTitle, statusDetail, installLink }, view) {
  status.hidden = false;
  status.dataset.tone = view.tone;
  statusTitle.textContent = view.title;
  statusDetail.textContent = view.detail;
  installLink.hidden = !view.showInstallLink;
}

export function setupDemoForm({
  form,
  input,
  button,
  status,
  statusTitle,
  statusDetail,
  installLink,
  request = requestSubmittedUrl,
}) {
  let submitting = false;
  const idleButtonText = button.textContent;
  const elements = { status, statusTitle, statusDetail, installLink };
  const showInvalidStatus = () => {
    renderStatus(elements, responseToViewModel({ ok: false, code: 'invalid_url' }));
  };

  input.addEventListener('invalid', showInvalidStatus);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    const url = input.value.trim();
    input.value = url;
    if (!form.checkValidity()) {
      showInvalidStatus();
      form.reportValidity();
      return;
    }

    submitting = true;
    input.disabled = true;
    button.disabled = true;
    button.textContent = 'Working';
    form.setAttribute('aria-busy', 'true');
    renderStatus(elements, {
      title: 'SocialSnag is working',
      detail: 'Keep this page open while SocialSnag finds the post media.',
      tone: 'working',
      showInstallLink: false,
    });

    let response;
    try {
      response = await request(url);
    } catch {
      response = { ok: false, code: 'unexpected', platform: null, count: 0 };
    } finally {
      submitting = false;
      input.disabled = false;
      button.disabled = false;
      button.textContent = idleButtonText;
      form.removeAttribute('aria-busy');
    }

    renderStatus(elements, responseToViewModel(response));
    status.focus();
  });

  return form;
}

function initializeDemoForm() {
  const form = document.querySelector('#url-demo-form');
  if (!form) return;

  setupDemoForm({
    form,
    input: document.querySelector('#submitted-post-url'),
    button: document.querySelector('#url-demo-submit'),
    status: document.querySelector('#demo-status'),
    statusTitle: document.querySelector('#demo-status-title'),
    statusDetail: document.querySelector('#demo-status-detail'),
    installLink: document.querySelector('#demo-install-link'),
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDemoForm, { once: true });
  } else {
    initializeDemoForm();
  }
}
