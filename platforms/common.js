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

  // Find the nearest media element when the click target isn't an img/video.
  // Social platforms wrap images in overlay divs, so the actual click often
  // lands on a transparent div rather than the img itself.
  findNearestMedia(element) {
    if (!element) return null;

    // Check if the target itself is media
    if (element.tagName === 'IMG') return element;
    if (element.tagName === 'VIDEO') return element;

    // Check children (click on overlay div containing an img)
    const img = element.querySelector('img');
    if (img) return img;
    const video = element.querySelector('video');
    if (video) return video;

    // Walk up and check siblings/parent containers
    let el = element;
    for (let i = 0; i < 5 && el && el !== document.body; i++) {
      el = el.parentElement;
      if (!el) break;
      const nearImg = el.querySelector('img');
      if (nearImg && nearImg.src && !nearImg.src.startsWith('data:')) return nearImg;
      const nearVideo = el.querySelector('video');
      if (nearVideo) return nearVideo;
    }

    return null;
  },
};
