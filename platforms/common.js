// SocialSnag common utilities
// Loaded before each platform's content script.

const SocialSnag = {
  _lastTarget: null,
  _resolveHandler: null,

  init(platformName) {
    // Track right-click target
    document.addEventListener('contextmenu', (e) => {
      SocialSnag._lastTarget = e.target;
    }, true);

    // Listen for resolve requests from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'resolve') {
        const handler = SocialSnag._resolveHandler;
        if (!handler) {
          sendResponse({ urls: [], platform: platformName });
          return true;
        }

        Promise.resolve(handler(message, SocialSnag._lastTarget))
          .then((urls) => {
            sendResponse({ urls: urls || [], platform: platformName });
          })
          .catch((err) => {
            console.error(`SocialSnag ${platformName} error:`, err);
            sendResponse({ urls: [], platform: platformName });
          });
        return true;
      }
    });
  },

  registerResolver(handler) {
    SocialSnag._resolveHandler = handler;
  },

  findPostContainer(element, selectors) {
    let el = element;
    while (el && el !== document.body) {
      for (const selector of selectors) {
        if (el.matches(selector)) return el;
      }
      el = el.parentElement;
    }
    return null;
  },

  collectMediaInContainer(container) {
    const items = [];
    if (!container) return items;

    container.querySelectorAll('img').forEach((img) => {
      const src = img.src || img.dataset.src || '';
      if (src && !src.startsWith('data:')) {
        items.push({ url: src, type: 'image', element: img });
      }
    });

    container.querySelectorAll('video').forEach((video) => {
      const src = video.src || video.querySelector('source')?.src || '';
      if (src && !src.startsWith('blob:')) {
        items.push({ url: src, type: 'video', element: video });
      }
    });

    return items;
  },

  async getCapturedMedia() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getCapturedMedia' }, (response) => {
        resolve(response?.urls || []);
      });
    });
  },

  extractId(url, pattern) {
    const match = url.match(pattern);
    return match ? match[1] : null;
  },
};
