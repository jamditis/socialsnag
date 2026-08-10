'use strict';

if (typeof document !== 'undefined') {
  const PLATFORMS = ['instagram', 'twitter', 'facebook', 'bluesky'];

  // Platforms that ship as optional_host_permissions. The grant is the only
  // enable switch: without it Chrome never injects the content script, so no
  // mirrored `platform_<name>` flag is written. A stored copy would go stale
  // the moment the user grants or revokes from chrome://extensions, which the
  // options page never sees.
  const OPTIONAL_PLATFORMS = {
    linkedin: ['*://*.linkedin.com/*', '*://*.licdn.com/*'],
  };

  const saveSettings = () => {
    const settings = {};

    PLATFORMS.forEach((p) => {
      settings[`platform_${p}`] = document.getElementById(`${p}-toggle`).checked;
    });


    settings.showNotifications = document.getElementById('notifications-toggle').checked;
    settings.downloadPath = document.getElementById('download-path').value.trim() || 'SocialSnag/{platform}';
    settings.zipMultiPosts = document.getElementById('zip-toggle').checked;
    settings.resolverDebug = document.getElementById('resolver-debug-toggle').checked;

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
      zipMultiPosts: false,
      resolverDebug: false,
    };
    PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

    chrome.storage.sync.get(defaults, (items) => {
      document.getElementById('advanced-toggle').checked = items.advancedMode;
      document.getElementById('notifications-toggle').checked = items.showNotifications;
      document.getElementById('zip-toggle').checked = items.zipMultiPosts;
      document.getElementById('resolver-debug-toggle').checked = items.resolverDebug;
      document.getElementById('download-path').value = items.downloadPath;
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
    const pathInput = document.getElementById('download-path');
    const preview = document.getElementById('path-preview');
    const val = pathInput.value.trim() || 'SocialSnag/{platform}';
    const example = val.replace(/\{platform\}/g, 'twitter');
    preview.textContent = `Downloads / ${example.replace(/[/\\]/g, ' / ')} / photo.jpg`;
  }

  let pathDebounce = null;
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
    document.getElementById('download-path').addEventListener('input', () => {
      updatePathPreview();
      clearTimeout(pathDebounce);
      pathDebounce = setTimeout(saveSettings, 500);
    });
    document.getElementById('open-downloads').addEventListener('click', () => {
      chrome.downloads.showDefaultFolder();
    });
  });
}
