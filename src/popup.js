'use strict';

const CORE_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'twitter', label: 'Twitter/X' },
  { id: 'facebook', label: 'Facebook' },
];

// Plain text labels — no emoji (project rule). Colored CSS backgrounds provide visual identity.
const PLATFORM_LABELS = {
  instagram: 'IG',
  twitter: 'X',
  facebook: 'FB',
};

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelector('.version').textContent = `v${chrome.runtime.getManifest().version}`;
  await renderPlatforms();
  await renderHistory();

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    await chrome.storage.local.set({ downloadHistory: [] });
    renderHistory();
  });
});

async function renderPlatforms() {
  const container = document.getElementById('platforms');
  const defaults = {};
  CORE_PLATFORMS.forEach((p) => { defaults[`platform_${p.id}`] = true; });
  const settings = await chrome.storage.sync.get(defaults);

  container.textContent = '';
  CORE_PLATFORMS.forEach((p) => {
    const enabled = settings[`platform_${p.id}`];
    const badge = document.createElement('div');
    badge.className = `platform-badge${enabled ? '' : ' disabled'}`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    badge.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = p.label;
    badge.appendChild(label);

    badge.addEventListener('click', async () => {
      const newValue = !settings[`platform_${p.id}`];
      settings[`platform_${p.id}`] = newValue;
      await chrome.storage.sync.set({ [`platform_${p.id}`]: newValue });
      badge.className = `platform-badge${newValue ? '' : ' disabled'}`;
    });

    container.appendChild(badge);
  });
}

async function renderHistory() {
  const container = document.getElementById('history-list');
  const { downloadHistory } = await chrome.storage.local.get({ downloadHistory: [] });

  container.textContent = '';

  if (downloadHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'No downloads yet. Right-click an image or video on a supported site to get started.';
    empty.appendChild(p);
    container.appendChild(empty);
    return;
  }

  // Show most recent 20
  const recent = downloadHistory.slice(-20).reverse();

  recent.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.addEventListener('click', () => {
      try {
        chrome.downloads.show(entry.downloadId);
      } catch (e) {
        item.classList.add('not-found');
      }
    });

    const icon = document.createElement('div');
    icon.className = `platform-icon ${entry.platform}`;
    icon.textContent = PLATFORM_LABELS[entry.platform] || '';
    item.appendChild(icon);

    const details = document.createElement('div');
    details.className = 'details';

    const filename = document.createElement('div');
    filename.className = 'filename';
    filename.textContent = entry.filename || 'unknown';
    details.appendChild(filename);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = entry.platform;
    details.appendChild(meta);

    item.appendChild(details);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = relativeTime(entry.timestamp);
    item.appendChild(time);

    container.appendChild(item);
  });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
