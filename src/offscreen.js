// SocialSnag offscreen document: builds zip blobs and writes the clipboard.
// The MV3 service worker cannot do either directly.
import { downloadZip } from 'client-zip';

// Copy text to the clipboard from the offscreen document. The async Clipboard
// API (navigator.clipboard.writeText) rejects here because an offscreen document
// is never focused; the hidden-textarea + execCommand('copy') path copies the
// current selection synchronously and works without focus. Returns whether the
// copy succeeded.
function copyTextToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Keep it out of view so it never flashes or scrolls the document.
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the service worker talks to the offscreen document. Content scripts
  // share the extension id, so also reject anything with a sender.tab -- those
  // come from a page context, which has no business driving zip/clipboard.
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  if (message?.target !== 'offscreen') return;

  if (message.action === 'clipboard') {
    const ok = copyTextToClipboard(message.text);
    sendResponse(ok ? { ok: true } : { ok: false, error: 'clipboard copy command was rejected' });
    return true;
  }

  if (message.action === 'revoke') {
    try { URL.revokeObjectURL(message.url); } catch (e) { /* already gone */ }
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'zip') {
    // message.files: [{ name, url }]
    (async () => {
      try {
        const inputs = [];
        for (const f of message.files) {
          try {
            // credentials: 'include' sends site cookies so authenticated-only
            // media (e.g. Instagram stories) fetches like a normal browser
            // request; the extension has host permission for these CDN origins.
            const resp = await fetch(f.url, { credentials: 'include' });
            if (resp.ok) inputs.push({ name: f.name, input: resp });
          } catch (e) { /* fall through: a short inputs list fails the zip below */ }
        }
        // If any file could not be fetched, fail the whole zip so the caller
        // falls back to per-file downloads. chrome.downloads.download needs no
        // host permission or CORS, so it can recover a file the offscreen fetch
        // missed — better than silently shipping an incomplete archive.
        if (inputs.length !== message.files.length) {
          sendResponse({ ok: false, error: `fetched ${inputs.length} of ${message.files.length} files` });
          return;
        }
        const blob = await downloadZip(inputs).blob();
        const url = URL.createObjectURL(blob);
        sendResponse({ ok: true, url, count: inputs.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
