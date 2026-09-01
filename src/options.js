import { renderTemplate, templateFieldError } from './platforms/common.js';

if (typeof document !== 'undefined') {
  const PLATFORMS = ['instagram', 'twitter', 'facebook', 'bluesky'];

  // Platforms that ship as optional_host_permissions. The grant is the only
  // enable switch: without it Chrome never injects the content script, so no
  // mirrored `platform_<name>` flag is written. A stored copy would go stale
  // the moment the user grants or revokes from chrome://extensions, which the
  // options page never sees.
  const OPTIONAL_PLATFORMS = {
    linkedin: ['*://*.linkedin.com/*', '*://*.media.licdn.com/*'],
  };

  // One sample post, the same field bag resolveBaseFilename builds for a real
  // download, so the live previews show exactly what a template would produce.
  // formatLocalDate lives in the background bundle, which the options page does
  // not import; today's date in the user's own timezone is the two lines below.
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const SAMPLE_FIELDS = {
    platform: 'twitter',
    // 'image' or 'video' are the only types a resolver emits; 'photo' would render a
    // {type} the download never produces, so the preview would promise the wrong name.
    type: 'image',
    postId: '1234567890',
    username: 'janedoe',
    index: 1,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };

  const showFieldError = (id, reason) => {
    const el = document.getElementById(id);
    el.textContent = reason || '';
    el.hidden = !reason;
  };

  // Validate both template fields on every input and show the reason inline.
  // Returns the two errors so the save path can decide what is safe to persist.
  const refreshFieldErrors = () => {
    const filenameErr = templateFieldError(
      document.getElementById('filename-template').value.trim(),
    );
    const pathErr = templateFieldError(
      document.getElementById('download-path').value.trim(),
      { allowSlash: true },
    );
    showFieldError('filename-template-error', filenameErr);
    showFieldError('download-path-error', pathErr);
    return { filenameErr, pathErr };
  };

  const saveSettings = () => {
    const settings = {};

    PLATFORMS.forEach((p) => {
      settings[`platform_${p}`] = document.getElementById(`${p}-toggle`).checked;
    });


    settings.showNotifications = document.getElementById('notifications-toggle').checked;
    settings.zipMultiPosts = document.getElementById('zip-toggle').checked;
    settings.resolverDebug = document.getElementById('resolver-debug-toggle').checked;
    settings.downloadQuality = document.getElementById('download-quality').value;

    // Refuse to persist an invalid template: keep the last good value stored so a
    // typo mid-edit does not overwrite a working setting. chrome.storage.sync.set
    // writes only the keys it is given, so omitting one leaves its stored value.
    const { filenameErr, pathErr } = refreshFieldErrors();
    if (filenameErr === null) {
      settings.filenameTemplate = document.getElementById('filename-template').value.trim();
    }
    if (pathErr === null) {
      settings.downloadPath = document.getElementById('download-path').value.trim() || 'SocialSnag/{platform}';
    }

    const advancedCheckbox = document.getElementById('advanced-toggle');

    if (advancedCheckbox.checked) {
      chrome.permissions.request({ permissions: ['webRequest'] }, (granted) => {
        if (granted) {
          settings.advancedMode = true;
          chrome.storage.sync.set(settings, () => {
            if (chrome.runtime.lastError) console.error('SocialSnag: save failed:', chrome.runtime.lastError.message);
          });
          chrome.runtime.sendMessage({ action: 'enableAdvancedMode' });
        } else {
          advancedCheckbox.checked = false;
          settings.advancedMode = false;
          chrome.storage.sync.set(settings, () => {
            if (chrome.runtime.lastError) console.error('SocialSnag: save failed:', chrome.runtime.lastError.message);
          });
        }
      });
    } else {
      settings.advancedMode = false;
      chrome.runtime.sendMessage({ action: 'disableAdvancedMode' });
      chrome.permissions.remove({ permissions: ['webRequest'] });
      chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) console.error('SocialSnag: save failed:', chrome.runtime.lastError.message);
      });
    }
  };

  const restoreOptions = () => {
    const defaults = {
      showNotifications: true,
      advancedMode: false,
      downloadPath: 'SocialSnag/{platform}',
      filenameTemplate: '',
      zipMultiPosts: false,
      resolverDebug: false,
      downloadQuality: 'largest',
    };
    PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

    chrome.storage.sync.get(defaults, (items) => {
      document.getElementById('advanced-toggle').checked = items.advancedMode;
      document.getElementById('notifications-toggle').checked = items.showNotifications;
      document.getElementById('zip-toggle').checked = items.zipMultiPosts;
      document.getElementById('resolver-debug-toggle').checked = items.resolverDebug;
      document.getElementById('download-quality').value = items.downloadQuality;
      document.getElementById('download-path').value = items.downloadPath;
      document.getElementById('filename-template').value = items.filenameTemplate;
      PLATFORMS.forEach((p) => {
        document.getElementById(`${p}-toggle`).checked = items[`platform_${p}`];
      });
      // Read the live permission rather than the stored flag: the user can
      // revoke site access from chrome://extensions without this page knowing,
      // and a toggle stuck "on" would promise a resolver Chrome is no longer
      // injecting.
      Object.entries(OPTIONAL_PLATFORMS).forEach(([p, origins]) => {
        chrome.permissions.contains({ origins }, (granted) => {
          document.getElementById(`${p}-toggle`).checked = !!granted;
        });
      });
      updatePathPreview();
      updateFilenamePreview();
      refreshFieldErrors();
    });
  };

  // Toggling an optional platform is a permission change first and a setting
  // second. The checkbox is corrected to whatever Chrome actually decided, so a
  // denied prompt leaves the UI honest instead of showing an enabled platform.
  const toggleOptionalPlatform = (name) => {
    const box = document.getElementById(`${name}-toggle`);
    const origins = OPTIONAL_PLATFORMS[name];

    if (box.checked) {
      chrome.permissions.request({ origins }, (granted) => {
        box.checked = !!granted;
        saveSettings();
      });
    } else {
      chrome.permissions.remove({ origins }, () => {
        box.checked = false;
        saveSettings();
      });
    }
  };

  function updatePathPreview() {
    const preview = document.getElementById('path-preview');
    const val = document.getElementById('download-path').value.trim() || 'SocialSnag/{platform}';
    // An invalid folder has no honest preview; the inline error carries the reason.
    if (templateFieldError(val, { allowSlash: true }) !== null) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    // Render the folder through the same token set as the saved path, so the preview
    // shows the resolved {date}/{username}/... a download actually writes, not a
    // literal token.
    const example = renderTemplate(val, SAMPLE_FIELDS);
    preview.textContent = `Downloads / ${example.replace(/[/\\]/g, ' / ')} / photo.jpg`;
  }

  function updateFilenamePreview() {
    const preview = document.getElementById('filename-preview');
    const value = document.getElementById('filename-template').value.trim();
    // Empty keeps each platform's own name; show the resolver's real shape for the
    // sample post (Twitter names a photo tweet_<id>), not the platform_index string
    // that is only the last-resort fallback when a resolver returns no name at all.
    if (value === '') {
      preview.hidden = false;
      preview.textContent = `tweet_${SAMPLE_FIELDS.postId}.jpg`;
      return;
    }
    if (templateFieldError(value) !== null) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    preview.textContent = `${renderTemplate(value, SAMPLE_FIELDS)}.jpg`;
  }

  let saveDebounce = null;
  const onTemplateInput = (updatePreview) => {
    updatePreview();
    refreshFieldErrors();
    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(saveSettings, 500);
  };

  document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();

    PLATFORMS.forEach((p) => {
      document.getElementById(`${p}-toggle`).addEventListener('change', saveSettings);
    });
    Object.keys(OPTIONAL_PLATFORMS).forEach((p) => {
      document.getElementById(`${p}-toggle`).addEventListener('change', () => toggleOptionalPlatform(p));
    });
    document.getElementById('advanced-toggle').addEventListener('change', saveSettings);
    document.getElementById('notifications-toggle').addEventListener('change', saveSettings);
    document.getElementById('zip-toggle').addEventListener('change', saveSettings);
    document.getElementById('resolver-debug-toggle').addEventListener('change', saveSettings);
    document.getElementById('download-quality').addEventListener('change', saveSettings);
    document.getElementById('download-path').addEventListener('input', () => onTemplateInput(updatePathPreview));
    document.getElementById('filename-template').addEventListener('input', () => onTemplateInput(updateFilenamePreview));
    document.getElementById('open-downloads').addEventListener('click', () => {
      chrome.downloads.showDefaultFolder();
    });
  });
}
