// SocialSnag offscreen document: builds zip blobs and writes the clipboard.
// The MV3 service worker cannot do either directly.
import { downloadZip } from 'client-zip';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.target !== 'offscreen') return;

  if (message.action === 'clipboard') {
    navigator.clipboard.writeText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
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
            const resp = await fetch(f.url);
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
