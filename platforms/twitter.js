// SocialSnag — Twitter/X content script

SocialSnag.init('twitter');

SocialSnag.registerResolver((message, target) => {
  if (message.type === 'single') {
    return resolveSingle(message.srcUrl, target);
  }
  return resolveAll(target);
});

function resolveSingle(srcUrl, target) {
  const url = upgradeImageUrl(srcUrl);
  if (url) {
    const id = extractTweetId(target);
    return [{ url, type: 'image', filename: id ? `tweet_${id}` : null }];
  }

  if (target?.tagName === 'VIDEO' || target?.closest('video')) {
    return resolveVideo(target);
  }

  return [];
}

function resolveAll(target) {
  const tweet = SocialSnag.findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    '[data-testid="tweet"]',
  ]);
  if (!tweet) return resolveSingle(target?.src || '', target);

  const items = [];
  const id = extractTweetId(target);
  let index = 1;

  tweet.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
    const url = upgradeImageUrl(img.src);
    if (url) {
      items.push({
        url,
        type: 'image',
        filename: id ? `tweet_${id}_${index}` : null,
      });
      index++;
    }
  });

  return items.length > 0 ? items : resolveSingle(target?.src || '', target);
}

function upgradeImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
      u.searchParams.set('name', 'orig');
      return u.toString();
    }
    if (u.hostname === 'pbs.twimg.com' && u.pathname.includes('/profile_images/')) {
      return url.replace(/_(normal|bigger|mini|200x200|400x400)\./i, '.');
    }
  } catch (e) { /* ignore */ }
  return url.includes('twimg.com') ? url : null;
}

async function resolveVideo(target) {
  const captured = await SocialSnag.getCapturedMedia();
  const mp4s = captured
    .filter((c) => c.url.includes('video.twimg.com') && c.url.includes('.mp4'))
    .sort((a, b) => b.timestamp - a.timestamp);

  if (mp4s.length > 0) {
    return [{ url: mp4s[0].url, type: 'video', filename: null }];
  }
  return [];
}

function extractTweetId(target) {
  const tweet = SocialSnag.findPostContainer(target, [
    'article[data-testid="tweet"]',
    'article[role="article"]',
  ]);
  if (!tweet) return null;

  const link = tweet.querySelector('a[href*="/status/"]');
  if (link) {
    const match = link.href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}
