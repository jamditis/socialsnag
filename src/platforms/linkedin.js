// TODO: convert to ESM imports when re-enabling this platform
// SocialSnag — LinkedIn content script

SocialSnag.init('linkedin');

SocialSnag.registerResolver((message, target) => {
  if (message.type === 'single') {
    return resolveSingle(message.srcUrl, target);
  }
  return resolveAll(target);
});

function resolveSingle(srcUrl, target) {
  const url = upgradeUrl(srcUrl);
  if (url) {
    const id = extractPostId();
    return [{ url, type: 'image', filename: id ? `post_${id}` : null }];
  }

  // If click landed on overlay, find nearest media
  const nearest = SocialSnag.findNearestMedia(target);
  if (nearest?.tagName === 'IMG') {
    const upgraded = upgradeUrl(nearest.src);
    if (upgraded) {
      const id = extractPostId();
      return [{ url: upgraded, type: 'image', filename: id ? `post_${id}` : null }];
    }
  }

  const video = nearest?.tagName === 'VIDEO' ? nearest
    : target?.closest('video') || (target?.tagName === 'VIDEO' ? target : null);
  if (video) {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      return [{ url: src, type: 'video', filename: null }];
    }
  }

  return [];
}

function resolveAll(target) {
  const post = SocialSnag.findPostContainer(target, [
    '.feed-shared-update-v2',
    '[data-urn]',
    '.social-details-social-activity',
  ]);
  if (!post) return resolveSingle(target?.src || '', target);

  const items = [];
  const id = extractPostId();
  let index = 1;

  post.querySelectorAll('img[src*="media.licdn.com"]').forEach((img) => {
    const url = upgradeUrl(img.src);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: id ? `post_${id}_${index}` : null,
      });
      index++;
    }
  });

  post.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src;
    if (src && !src.startsWith('blob:')) {
      items.push({ url: src, type: 'video', filename: id ? `post_${id}_${index}` : null });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function upgradeUrl(url) {
  if (!url || !url.includes('media.licdn.com')) return null;
  return url.replace(/\/shrink_\d+_\d+\//, '/');
}

function extractPostId() {
  const match = window.location.href.match(/activity-(\d+)/);
  if (match) return match[1];

  const urnMatch = window.location.href.match(/urn:li:activity:(\d+)/);
  if (urnMatch) return urnMatch[1];

  return null;
}
