'use strict';

if (typeof document !== 'undefined') {
  const PLATFORMS = ['instagram', 'twitter', 'facebook', 'bluesky'];

  const saveSettings = () => {
    const settings = {};

    PLATFORMS.forEach((p) => {
      settings[`platform_${p}`] = document.getElementById(`${p}-toggle`).checked;
    });

    settings.showNotifications = document.getElementById('notifications-toggle').checked;
    settings.downloadPath = document.getElementById('download-path').value.trim() || 'SocialSnag/{platform}';

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
    };
    PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

    chrome.storage.sync.get(defaults, (items) => {
      document.getElementById('advanced-toggle').checked = items.advancedMode;
      document.getElementById('notifications-toggle').checked = items.showNotifications;
      document.getElementById('download-path').value = items.downloadPath;
      PLATFORMS.forEach((p) => {
        document.getElementById(`${p}-toggle`).checked = items[`platform_${p}`];
      });
      updatePathPreview();
    });
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
    document.getElementById('advanced-toggle').addEventListener('change', saveSettings);
    document.getElementById('notifications-toggle').addEventListener('change', saveSettings);
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
