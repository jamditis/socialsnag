'use strict';

const PLATFORMS = ['instagram', 'twitter', 'facebook', 'youtube', 'linkedin', 'tiktok'];

const saveOptions = () => {
  const settings = {
    showNotifications: document.getElementById('showNotifications').checked,
  };

  PLATFORMS.forEach((p) => {
    settings[`platform_${p}`] = document.getElementById(`platform-${p}`).checked;
  });

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('status');
    if (chrome.runtime.lastError) {
      status.textContent = `Failed to save: ${chrome.runtime.lastError.message}`;
      status.className = 'error';
    } else {
      status.textContent = 'Settings saved.';
      status.className = 'success';
    }
    status.style.opacity = 1;
    setTimeout(() => { status.style.opacity = 0; }, 2000);
  });
};

const restoreOptions = () => {
  const defaults = { showNotifications: true };
  PLATFORMS.forEach((p) => { defaults[`platform_${p}`] = true; });

  chrome.storage.sync.get(defaults, (items) => {
    document.getElementById('showNotifications').checked = items.showNotifications;
    PLATFORMS.forEach((p) => {
      document.getElementById(`platform-${p}`).checked = items[`platform_${p}`];
    });
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
