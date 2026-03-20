'use strict';

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function initPopup() {
  const NS = 'http://www.w3.org/2000/svg';

  const CORE_PLATFORMS = [
    { id: 'instagram', label: 'Instagram' },
    { id: 'twitter', label: 'Twitter/X' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'bluesky', label: 'Bluesky' },
  ];

  function svgEl(tag, attrs, children) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    }
    if (children) {
      children.forEach((c) => el.appendChild(c));
    }
    return el;
  }

  function makePlatformIcon(platform) {
    if (platform === 'instagram') {
      return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        svgEl('rect', { x: '2', y: '2', width: '20', height: '20', rx: '5' }),
        svgEl('circle', { cx: '12', cy: '12', r: '4' }),
        svgEl('circle', { cx: '17.5', cy: '6.5', r: '1.5', fill: 'currentColor', stroke: 'none' }),
      ]);
    }
    if (platform === 'twitter') {
      return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        svgEl('path', { d: 'M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5 0-.28 0-.56-.02-.83A7.72 7.72 0 0023 3z' }),
      ]);
    }
    if (platform === 'facebook') {
      return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        svgEl('path', { d: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z' }),
      ]);
    }
    if (platform === 'bluesky') {
      return svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
        svgEl('path', { d: 'M12 3C9.5 5 5 8.5 5 12a4 4 0 004.5 4c1 0 1.8-.4 2.5-1-.7.6-1.5 1-2.5 1A4 4 0 015 12c0-3.5 4.5-7 7-9z', fill: 'currentColor', stroke: 'none' }),
        svgEl('path', { d: 'M12 3c2.5 2 7 5.5 7 9a4 4 0 01-4.5 4c-1 0-1.8-.4-2.5-1 .7.6 1.5 1 2.5 1A4 4 0 0019 12c0-3.5-4.5-7-7-9z', fill: 'currentColor', stroke: 'none' }),
      ]);
    }
    return null;
  }

  async function renderStatus() {
    const container = document.getElementById('status-grid');
    const defaults = {};
    CORE_PLATFORMS.forEach((p) => { defaults[`platform_${p.id}`] = true; });
    const settings = await chrome.storage.sync.get(defaults);

    container.textContent = '';
    CORE_PLATFORMS.forEach((p) => {
      const enabled = settings[`platform_${p.id}`];
      const item = document.createElement('div');
      item.className = `status-item${enabled ? '' : ' disabled'}`;

      const dot = document.createElement('span');
      dot.className = 'status-dot';
      item.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = p.label;
      item.appendChild(label);

      container.appendChild(item);
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
      icon.className = `file-icon ${entry.platform}`;
      const svgIcon = makePlatformIcon(entry.platform);
      if (svgIcon) {
        icon.appendChild(svgIcon);
      }
      item.appendChild(icon);

      const details = document.createElement('div');
      details.className = 'file-details';

      const filename = document.createElement('div');
      filename.className = 'file-name';
      filename.textContent = entry.filename || 'unknown';
      details.appendChild(filename);

      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = `${entry.platform} - ${relativeTime(entry.timestamp)}`;
      details.appendChild(meta);

      item.appendChild(details);

      container.appendChild(item);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.querySelector('.version').textContent = `v${chrome.runtime.getManifest().version}`;
    await renderStatus();
    await renderHistory();

    document.getElementById('open-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('clear-history').addEventListener('click', async () => {
      await chrome.storage.local.set({ downloadHistory: [] });
      renderHistory();
    });
  });
}

if (typeof document !== 'undefined') {
  initPopup();
}
