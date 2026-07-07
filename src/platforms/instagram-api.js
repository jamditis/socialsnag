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
