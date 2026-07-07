// SocialSnag offscreen document: builds zip blobs and writes the clipboard.
// The MV3 service worker cannot do either directly.
import { downloadZip } from 'client-zip';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;

  if (message.action === 'clipboard') {
    navigator.clipboard.writeText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (message.action === 'zip') {
    // message.files: [{ name, url }]
    (async () => {
      const inputs = [];
      for (const f of message.files) {
        try {
          const resp = await fetch(f.url);
          if (resp.ok) inputs.push({ name: f.name, input: resp });
        } catch (e) { /* skip a failed file */ }
      }
      if (inputs.length === 0) { sendResponse({ ok: false, error: 'no files fetched' }); return; }
      const blob = await downloadZip(inputs).blob();
      const url = URL.createObjectURL(blob);
      sendResponse({ ok: true, url, count: inputs.length });
    })();
    return true;
  }
});
