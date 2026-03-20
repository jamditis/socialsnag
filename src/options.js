'use strict';

const PLATFORMS = ['instagram', 'twitter', 'facebook'];

const showStatus = (message, type) => {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type;
  status.style.opacity = 1;
  setTimeout(() => { status.style.opacity = 0; }, 2000);
};

const saveOptions = () => {
  const settings = {
    showNotifications: document.getElementById('showNotifications').checked,
  };

  PLATFORMS.forEach((p) => {
    settings[`platform_${p}`] = document.getElementById(`platform-${p}`).checked;
  });

  const advancedCheckbox = document.getElementById('advancedMode');

  if (advancedCheckbox.checked) {
    chrome.permissions.request({ permissions: ['webRequest'] }, (granted) => {
      if (granted) {
        settings.advancedMode = true;
        chrome.storage.sync.set(settings, () => {
          if (chrome.runtime.lastError) {
            showStatus(`Failed to save: ${chrome.runtime.lastError.message}`, 'error');
            return;
          }
          chrome.runtime.sendMessage({ action: 'enableAdvancedMode' });
          showStatus('Settings saved.', 'success');
        });
      } else {
        advancedCheckbox.checked = false;
        settings.advancedMode = false;
        chrome.storage.sync.set(settings, () => {
          if (chrome.runtime.lastError) {
            showStatus(`Failed to save: ${chrome.runtime.lastError.message}`, 'error');
            return;
          }
          showStatus('Permission denied. Advanced mode disabled.', 'error');
        });
      }
    });
  } else {
    settings.advancedMode = false;
    chrome.runtime.sendMessage({ action: 'disableAdvancedMode' });
    chrome.permissions.remove({ permissions: ['webRequest'] });
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        showStatus(`Failed to save: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      showStatus('Settings saved.', 'success');
    });
  }
};

const restoreOptions = () => {
  const defaults = {
    showNotifications: true,
    advancedMode: false,
  };
  PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

  chrome.storage.sync.get(defaults, (items) => {
    document.getElementById('showNotifications').checked = items.showNotifications;
    document.getElementById('advancedMode').checked = items.advancedMode;
    PLATFORMS.forEach((p) => {
      document.getElementById(`platform-${p}`).checked = items[`platform_${p}`];
    });
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
