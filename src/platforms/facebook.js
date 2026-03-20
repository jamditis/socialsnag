// SocialSnag — Facebook content script

SocialSnag.init('facebook');

SocialSnag.registerResolver(async (message, target) => {
  if (message.type === 'single') {
    return resolveSingle(message.srcUrl, target);
  }
  return resolveAll(target);
});

function resolveSingle(srcUrl, target) {
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPhotoId(srcUrl);
    return [{ url, type: 'image', filename: id ? `photo_${id}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = SocialSnag.findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPhotoId(nearest.src);
      return [{ url: upgraded, type: 'image', filename: id ? `photo_${id}` : null }];
    }
  }

  const videoUrl = findVideoUrl(target);
  if (videoUrl) {
    return [{ url: videoUrl, type: 'video', filename: null }];
  }

  return [];
}

async function resolveAll(target) {
  const post = SocialSnag.findPostContainer(target, [
    '[role="article"]',
    '[data-pagelet*="FeedUnit"]',
    '[data-pagelet*="ProfileTimeline"]',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  let index = 1;

  post.querySelectorAll('img[src*="fbcdn.net"]').forEach((img) => {
    const url = upgradeUrl(img.src);
    if (url) {
      // Skip tiny images (profile pics, reaction icons)
      if (img.width > 50 || img.naturalWidth > 50 || !img.width) {
        const id = extractPhotoId(img.src);
        items.push({
          url,
          type: 'image',
          filename: id ? `photo_${id}_${index}` : null,
        });
        index++;
      }
    }
  });

  // Fall back to webRequest captures if DOM is sparse
  if (items.length === 0) {
    const captured = await SocialSnag.getCapturedMedia();
    const fbImages = captured
      .filter((c) => c.url.includes('fbcdn.net') && c.type === 'image')
      .slice(-5);

    fbImages.forEach((c) => {
      items.push({
        url: c.url,
        type: 'image',
        filename: `photo_${index}`,
      });
      index++;
    });
  }

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function upgradeUrl(url) {
  if (!url || !url.includes('fbcdn.net')) return null;
  // Try removing size constraints from path
  let upgraded = url.replace(/\/[sp]\d+x\d+\//, '/');
  return upgraded;
}

function extractPhotoId(url) {
  if (!url) return null;
  const match = url.match(/\/(\d{10,})/);
  return match ? match[1] : null;
}

function findVideoUrl(target) {
  const container = target?.closest('[role="article"]') || target?.parentElement;
  if (!container) return null;

  const video = container.querySelector('video');
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) return src;
  }

  // Try to find playable_url in page scripts
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent;
    if (text.includes('playable_url_quality_hd')) {
      const match = text.match(/"playable_url_quality_hd":"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }
    }
    if (text.includes('playable_url')) {
      const match = text.match(/"playable_url":"(https?:[^"]+)"/);
      if (match) {
        return match[1].replace(/\\\//g, '/');
      }
    }
  }

  return null;
}
