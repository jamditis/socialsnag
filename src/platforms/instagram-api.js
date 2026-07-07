// SocialSnag — Instagram private web API helpers (pure, testable)

export const IG_APP_ID = '936619743392459';

const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Convert an Instagram post shortcode to its numeric media pk.
// Returns null for empty input or any character outside the alphabet.
export function shortcodeToMediaId(shortcode) {
  if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  let id = 0n;
  for (const ch of shortcode) {
    const v = SHORTCODE_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

// Pick the highest-resolution image candidate url (by pixel area).
export function pickBestCandidate(candidates) {
  if (!Array.isArray(candidates)) return null;
  const withUrl = candidates.filter((c) => c && c.url);
  if (withUrl.length === 0) return null;
  const area = (c) => (c.width || 0) * (c.height || 0);
  return withUrl.slice().sort((a, b) => area(b) - area(a))[0].url;
}

// Pick the widest video version url.
export function pickBestVideo(versions) {
  if (!Array.isArray(versions)) return null;
  const withUrl = versions.filter((v) => v && v.url);
  if (withUrl.length === 0) return null;
  return withUrl.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
}

// Build one media item from a post/carousel node. isCarousel controls naming.
function mediaFromNode(node, shortcode, index, isCarousel) {
  if (Array.isArray(node.video_versions) && node.video_versions.length) {
    const url = pickBestVideo(node.video_versions);
    if (!url) return null;
    const filename = isCarousel ? `post_${shortcode}_${index}` : `reel_${shortcode}`;
    return { url, type: 'video', filename, index };
  }
  const url = pickBestCandidate(node?.image_versions2?.candidates);
  if (!url) return null;
  const filename = isCarousel ? `post_${shortcode}_${index}` : `post_${shortcode}`;
  return { url, type: 'image', filename, index };
}

// Enumerate all media in a post response (single image/video or full carousel).
export function parsePostMedia(apiJson, shortcode) {
  const item = apiJson?.items?.[0];
  if (!item) return [];
  if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
    return item.carousel_media
      .map((node, i) => mediaFromNode(node, shortcode, i + 1, true))
      .filter(Boolean);
  }
  const single = mediaFromNode(item, shortcode, 1, false);
  return single ? [single] : [];
}

// Parse a story page path: /stories/{username}/{storyId}/
export function extractStoryRef(pathname) {
  const m = pathname.match(/^\/stories\/([^/]+)\/(\d+)/);
  return m ? { username: m[1], storyId: m[2] } : null;
}

// Enumerate story items from a reels_media response. If storyId matches an
// item pk, return only that one; otherwise return the whole active tray.
export function parseStoryTray(apiJson, { storyId } = {}) {
  const items = apiJson?.reels_media?.[0]?.items || [];
  const mapped = items.map((it, i) => {
    const base = { pk: String(it.pk ?? i), index: i + 1 };
    if (Array.isArray(it.video_versions) && it.video_versions.length) {
      const url = pickBestVideo(it.video_versions);
      return url ? { url, type: 'video', filename: `story_${base.pk}`, index: base.index, pk: base.pk } : null;
    }
    const url = pickBestCandidate(it?.image_versions2?.candidates);
    return url ? { url, type: 'image', filename: `story_${base.pk}`, index: base.index, pk: base.pk } : null;
  }).filter(Boolean);

  if (storyId) {
    const one = mapped.find((m) => m.pk === String(storyId));
    if (one) return [one];
  }
  return mapped.map((m) => ({ url: m.url, type: m.type, filename: m.filename, index: m.index }));
}

// Map an Instagram API HTTP status to a user-facing message.
export function mapIgStatusToMessage(status) {
  if (status === 401 || status === 403) return 'Log in to Instagram to download this.';
  if (status === 429) return 'Instagram is rate-limiting downloads. Try again in a minute.';
  if (status === 404) return 'This Instagram media has expired or was not found.';
  return 'Instagram did not return this media. Try refreshing the page.';
}
