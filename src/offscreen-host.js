// Service-worker-side helpers for talking to the offscreen document.

const OFFSCREEN_PATH = 'offscreen.html';
let creating = null; // single-flight guard

export async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  if (creating) { await creating; return; }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS', 'CLIPBOARD'],
    justification: 'Bundle downloaded media into a zip and copy media URLs to the clipboard.',
  });
  try { await creating; } finally { creating = null; }
}

export async function copyViaOffscreen(text) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', action: 'clipboard', text });
}

// files: [{ name, url }] — returns { url, count } for the zip, or null.
export async function zipViaOffscreen(files) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'zip', files });
  return res?.ok ? { url: res.url, count: res.count } : null;
}

// Revoke a blob URL the offscreen document created. Only that realm can revoke
// it, so round a message through it. Best-effort: if the doc is gone the URL
// dies with it.
export async function revokeViaOffscreen(url) {
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', action: 'revoke', url });
  } catch (e) { /* offscreen gone */ }
}
