// SocialSnag — Instagram content script

SocialSnag.init('instagram');

SocialSnag.registerResolver(async (message, target) => {
  if (message.type === 'single') {
    return resolveSingle(message.srcUrl, target);
  }
  return resolveAll(target);
});

function resolveSingle(srcUrl, target) {
  const url = upgradeImageUrl(srcUrl, target);
  if (url) {
    const shortcode = extractShortcode();
    return [{ url, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = SocialSnag.findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeImageUrl(nearest.src, nearest);
    if (upgraded) {
      const shortcode = extractShortcode();
      return [{ url: upgraded, type: 'image', filename: shortcode ? `post_${shortcode}` : null }];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      const shortcode = extractShortcode();
      return [{ url: src, type: 'video', filename: shortcode ? `reel_${shortcode}` : null }];
    }
  }

  // Fall back to resolveAll
  return [];
}

async function resolveAll(target) {
  // Try JSON extraction first for carousel data
  const jsonItems = extractFromPageJson();
  if (jsonItems.length > 0) return jsonItems;

  // Fall back to DOM collection
  const post = SocialSnag.findPostContainer(target, [
    'article',
    '[role="presentation"]',
    'div._aagv',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  const shortcode = extractShortcode();
  let index = 1;

  post.querySelectorAll('img[src*="cdninstagram.com"]').forEach((img) => {
    const url = upgradeImageUrl(img.src, img);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    }
  });

  post.querySelectorAll('video').forEach((video) => {
    const src = video.src;
    if (src && !src.startsWith('blob:')) {
      items.push({
        url: src,
        type: 'video',
        filename: shortcode ? `post_${shortcode}_${index}` : null,
      });
      index++;
    }
  });

  // If DOM only found one item, check webRequest captures for more
  if (items.length <= 1) {
    const captured = await SocialSnag.getCapturedMedia();
    const igMedia = captured
      .filter((c) => c.url.includes('cdninstagram.com') && c.type === 'image')
      .slice(-10);

    igMedia.forEach((c) => {
      if (!items.some((i) => i.url === c.url)) {
        items.push({
          url: c.url,
          type: 'image',
          filename: shortcode ? `post_${shortcode}_${index}` : null,
        });
        index++;
      }
    });
  }

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function upgradeImageUrl(url, imgElement) {
  if (!url || !url.includes('cdninstagram.com')) return null;

  // Check srcset for highest resolution
  if (imgElement?.srcset) {
    const candidates = imgElement.srcset.split(',').map((s) => {
      const parts = s.trim().split(/\s+/);
      const width = parseInt(parts[1]) || 0;
      return { url: parts[0], width };
    });
    candidates.sort((a, b) => b.width - a.width);
    if (candidates.length > 0 && candidates[0].url) {
      return candidates[0].url;
    }
  }

  // Remove size constraints from URL path
  return url.replace(/\/s\d+x\d+\//, '/');
}

function extractShortcode() {
  const match = window.location.pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[2] : null;
}

function extractFromPageJson() {
  const items = [];

  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data.image) {
        const images = Array.isArray(data.image) ? data.image : [data.image];
        const shortcode = extractShortcode();
        images.forEach((imgUrl, i) => {
          items.push({
            url: imgUrl,
            type: 'image',
            filename: shortcode ? `post_${shortcode}_${i + 1}` : null,
          });
        });
      }
    } catch (e) { /* ignore */ }
  }

  return items;
}
