// SocialSnag — TikTok content script

SocialSnag.init('tiktok');

SocialSnag.registerResolver(async (message, target) => {
  // TikTok is primarily video — try JSON extraction first
  const videoData = extractFromRehydrationJson();
  if (videoData) return [videoData];

  // Fall back to webRequest captures
  const captured = await SocialSnag.getCapturedMedia();
  const videos = captured
    .filter((c) => c.url.match(/tiktokcdn/) && c.type === 'media')
    .sort((a, b) => b.timestamp - a.timestamp);

  if (videos.length > 0) {
    const videoId = extractVideoId();
    return [{
      url: videos[0].url,
      type: 'video',
      filename: videoId ? `video_${videoId}` : null,
    }];
  }

  // Check for photo posts
  const photos = extractPhotoPosts();
  if (photos.length > 0) return photos;

  return [];
});

function extractFromRehydrationJson() {
  const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (!script) return null;

  try {
    const data = JSON.parse(script.textContent);
    const videoDetail = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct;

    if (videoDetail?.video) {
      const videoId = videoDetail.id || extractVideoId();
      const playUrl = videoDetail.video.playAddr || videoDetail.video.downloadAddr;

      if (playUrl) {
        return {
          url: playUrl,
          type: 'video',
          filename: videoId ? `video_${videoId}` : null,
        };
      }
    }
  } catch (e) {
    console.error('SocialSnag: failed to parse TikTok JSON:', e);
  }

  return null;
}

function extractPhotoPosts() {
  const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (!script) return [];

  try {
    const data = JSON.parse(script.textContent);
    const videoDetail = data?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct;

    if (videoDetail?.imagePost?.images) {
      const videoId = videoDetail.id || extractVideoId();
      return videoDetail.imagePost.images.map((img, i) => ({
        url: img.imageURL?.urlList?.[0] || img.imageURL,
        type: 'image',
        filename: videoId ? `photo_${videoId}_${i + 1}` : null,
      })).filter((item) => item.url);
    }
  } catch (e) { /* ignore */ }

  return [];
}

function extractVideoId() {
  const match = window.location.pathname.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}
