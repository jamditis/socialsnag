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

// Choose one media url from a size-ranked candidate list by a quality preference.
//
// The default preference, 'largest', is SocialSnag's historical behavior: take the
// biggest candidate. A resolution cap ({ maxWidth: N }) instead asks for the best
// candidate no wider than N pixels: the plumbing issue #19 needs so a user can pick
// a download resolution rather than always the largest. If every candidate is wider
// than the cap, the smallest one is returned, so a download still happens rather
// than failing. `size` ranks candidates for the "largest" choice (pixel area for
// images, width for videos), so each caller keeps its own metric.
export function selectByQuality(items, size, preference = 'largest') {
  if (!Array.isArray(items)) return null;
  const withUrl = items.filter((c) => c && c.url);
  if (withUrl.length === 0) return null;

  // The cap is always measured by `.width`, independent of the `size` ranking
  // metric: a resolution cap means pixel width, and each caller's `size` (area
  // for images, width for videos) only ranks among the candidates that fit.
  const cap =
    preference && typeof preference === 'object' && Number.isFinite(preference.maxWidth)
      ? preference.maxWidth
      : null;

  let pool = withUrl;
  if (cap !== null) {
    const underCap = withUrl.filter((c) => (c.width || 0) <= cap);
    // When nothing fits under the cap, fall back to the narrowest candidate by
    // width (the cap dimension) so a download still happens and the result is
    // the closest thing to the requested width, not the smallest by area.
    pool = underCap.length > 0
      ? underCap
      : [withUrl.slice().sort((a, b) => (a.width || 0) - (b.width || 0))[0]];
  }
  return pool.slice().sort((a, b) => size(b) - size(a))[0].url;
}

// Pick an image candidate url. Defaults to the highest resolution (by pixel area);
// pass { maxWidth: N } to cap the resolution. See selectByQuality.
export function pickBestCandidate(candidates, preference = 'largest') {
  return selectByQuality(candidates, (c) => (c.width || 0) * (c.height || 0), preference);
}

// Pick a video version url. Defaults to the widest; pass { maxWidth: N } to cap the
// resolution. See selectByQuality.
export function pickBestVideo(versions, preference = 'largest') {
  return selectByQuality(versions, (v) => v.width || 0, preference);
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
  if (!m) return null;
  // /stories/highlights/<id>/ is a highlight, not an active story: "highlights"
  // is a literal path segment (not a username) and highlights are not served by
  // the reels tray API. Skip it so we don't look up an account named
  // "highlights" and download unrelated media; the page falls back to the
  // generic resolver instead. Highlight support is tracked for v1.3.
  if (m[1] === 'highlights') return null;
  return { username: m[1], storyId: m[2] };
}

// Enumerate story items from a reels_media response. If storyId matches an
// item pk, return only that one; otherwise return the whole active tray.
export function parseStoryTray(apiJson, { storyId } = {}) {
  const items = apiJson?.reels_media?.[0]?.items || [];
  const mapped = items.map((it, i) => {
    // Prefer the pk embedded in the string id (`<pk>_<userid>`) over the raw pk
    // field. When Instagram sends pk as a JSON number it loses its low digits
    // past 2^53, but id stays a string and keeps the full value — so deriving pk
    // from id keeps the match, the filename, and the download history all
    // lossless. Falls back to the pk field, then the index, when id is absent.
    const pk = it.id != null ? String(it.id).split('_')[0] : String(it.pk ?? i);
    const base = { pk, id: it.id, index: i + 1 };
    if (Array.isArray(it.video_versions) && it.video_versions.length) {
      const url = pickBestVideo(it.video_versions);
      return url ? { url, type: 'video', filename: `story_${base.pk}`, index: base.index, pk: base.pk, id: base.id } : null;
    }
    const url = pickBestCandidate(it?.image_versions2?.candidates);
    return url ? { url, type: 'image', filename: `story_${base.pk}`, index: base.index, pk: base.pk, id: base.id } : null;
  }).filter(Boolean);

  // A single-story request ("download this") must return that exact story or
  // nothing — never fall back to the whole tray. The URL's story can be missing
  // when it has expired (stories last 24h) or the URL is stale; returning empty
  // lets the caller show "expired or unavailable" instead of dumping every
  // currently-active story.
  if (storyId) {
    // base.pk is already the lossless pk (derived from the string id above when
    // present), so a direct compare matches a real ~19-digit story id that would
    // have been rounded if read from the numeric pk field.
    const target = String(storyId);
    const one = mapped.find((m) => m.pk === target);
    return one ? [{ url: one.url, type: one.type, filename: one.filename, index: one.index }] : [];
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

// Machine-readable companion to mapIgStatusToMessage. Keep the human copy above
// stable for existing callers while external-message consumers get a small code
// that never exposes request or account details.
export function mapIgStatusToCode(status) {
  if (status === 401 || status === 403) return 'auth_required';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'access_or_unavailable';
  if (status === 0) return 'no_media';
  return 'unexpected';
}
