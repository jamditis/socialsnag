// TODO: convert to ESM imports when re-enabling this platform
// SocialSnag — YouTube content script (thumbnails only)

SocialSnag.init('youtube');

SocialSnag.registerResolver((message, target) => {
  if (message.type === 'single') {
    return resolveSingle(message.srcUrl, target);
  }
  return resolveAll(target);
});

function resolveSingle(srcUrl, target) {
  const videoId = extractVideoIdFromImgUrl(srcUrl) || getPageVideoId();

  if (videoId) {
    return [{
      url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      type: 'image',
      filename: `thumb_${videoId}`,
    }];
  }

  // Channel art / profile pics — remove size suffix
  if (srcUrl && srcUrl.includes('yt3.ggpht.com')) {
    const upgraded = srcUrl.replace(/=s\d+[^&]*/, '=s0');
    return [{ url: upgraded, type: 'image', filename: null }];
  }

  return [];
}

function resolveAll(target) {
  return resolveSingle(target?.src || '', target);
}

function extractVideoIdFromImgUrl(url) {
  if (!url) return null;
  const match = url.match(/\/vi(?:_webp)?\/([a-zA-Z0-9_-]{11})\//);
  return match ? match[1] : null;
}

function getPageVideoId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v');
    if (v) return v;
  } catch (e) { /* ignore */ }

  const player = document.querySelector('ytd-watch-flexy');
  if (player) {
    return player.getAttribute('video-id');
  }

  const meta = document.querySelector('meta[property="og:video:url"]');
  if (meta) {
    const match = meta.content.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }

  return null;
}
