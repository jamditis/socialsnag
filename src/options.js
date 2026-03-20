'use strict';

if (typeof document !== 'undefined') {
  const PLATFORMS = ['instagram', 'twitter', 'facebook'];

  const saveSettings = () => {
    const settings = {
      showNotifications: true,
    };

    PLATFORMS.forEach((p) => {
      settings[`platform_${p}`] = document.getElementById(`${p}-toggle`).checked;
    });

    const advancedCheckbox = document.getElementById('advanced-toggle');

    if (advancedCheckbox.checked) {
      chrome.permissions.request({ permissions: ['webRequest'] }, (granted) => {
        if (granted) {
          settings.advancedMode = true;
          chrome.storage.sync.set(settings);
          chrome.runtime.sendMessage({ action: 'enableAdvancedMode' });
        } else {
          advancedCheckbox.checked = false;
          settings.advancedMode = false;
          chrome.storage.sync.set(settings);
        }
      });
    } else {
      settings.advancedMode = false;
      chrome.runtime.sendMessage({ action: 'disableAdvancedMode' });
      chrome.permissions.remove({ permissions: ['webRequest'] });
      chrome.storage.sync.set(settings);
    }
  };

  const restoreOptions = () => {
    const defaults = {
      showNotifications: true,
      advancedMode: false,
    };
    PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

    chrome.storage.sync.get(defaults, (items) => {
      document.getElementById('advanced-toggle').checked = items.advancedMode;
      PLATFORMS.forEach((p) => {
        document.getElementById(`${p}-toggle`).checked = items[`platform_${p}`];
      });
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();

    PLATFORMS.forEach((p) => {
      document.getElementById(`${p}-toggle`).addEventListener('change', saveSettings);
    });
    document.getElementById('advanced-toggle').addEventListener('change', saveSettings);
  });
}
