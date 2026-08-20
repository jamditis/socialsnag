// SocialSnag — Instagram private web API helpers (pure, testable)

import { classifyFailure, withItemMeta } from './common.js';

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
function mediaFromNode(node, shortcode, index, isCarousel, username = null) {
  if (Array.isArray(node.video_versions) && node.video_versions.length) {
    const url = pickBestVideo(node.video_versions);
    if (!url) return null;
    const filename = isCarousel ? `post_${shortcode}_${index}` : `reel_${shortcode}`;
    return withItemMeta(
      { url, type: 'video', filename, index },
      { postId: shortcode, username },
    );
  }
  const url = pickBestCandidate(node?.image_versions2?.candidates);
  if (!url) return null;
  const filename = isCarousel ? `post_${shortcode}_${index}` : `post_${shortcode}`;
  return withItemMeta(
    { url, type: 'image', filename, index },
    { postId: shortcode, username },
  );
}

// Enumerate all media in a post response (single image/video or full carousel).
export function parsePostMedia(apiJson, shortcode) {
  const item = apiJson?.items?.[0];
  if (!item) return [];
  const username = item.user?.username || null;
  if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
    return item.carousel_media
      .map((node, i) => mediaFromNode(node, shortcode, i + 1, true, username))
      .filter(Boolean);
  }
  const single = mediaFromNode(item, shortcode, 1, false, username);
  return single ? [single] : [];
}

// Parse a story page path: /stories/{username}/{storyId}/
export function extractStoryRef(pathname) {
  const m = pathname.match(/^\/stories\/([^/]+)\/(\d+)/);
  if (!m) return null;
  // /stories/highlights/<id>/ is a highlight, not an active story: "highlights"
  // is a literal path segment (not a username) and a highlight is not addressed
  // by username. Skip it so we don't look up an account named "highlights" and
  // download unrelated media; extractHighlightRef below is the other half of
  // this guard and routes the highlight through the reels_media API instead.
  if (m[1] === 'highlights') return null;
  return { username: m[1], storyId: m[2] };
}

// Parse a highlight page path: /stories/highlights/{highlightId}/ for the whole
// highlight, or /stories/highlights/{highlightId}/{itemId}/ for a single item.
// This is the other half of extractStoryRef's `highlights` guard: that function
// returns null here so a highlight never routes to a story lookup, and this one
// enumerates it through the highlights reel API (reel_ids=highlight:<id>). The
// itemId sits where extractStoryRef's storyId sits, so parseStoryTray's
// single-item filter reuses unchanged. See issue #29.
export function extractHighlightRef(pathname) {
  const m = pathname.match(/^\/stories\/highlights\/(\d+)(?:\/(\d+))?/);
  if (!m) return null;
  return { highlightId: m[1], itemId: m[2] || null };
}

// Enumerate story items from a reels_media response. If storyId matches an
// item pk, return only that one; otherwise return the whole active tray.
export function parseStoryTray(apiJson, { storyId, username = null } = {}) {
  const reel = apiJson?.reels_media?.[0];
  const items = reel?.items || [];
  // A highlight skips the username -> user-id lookup, so its caller has no owner
  // to pass. The reels_media payload names the owner at reels_media[0].user.username,
  // so fall back to it. This keeps {username} filename and folder templates filled
  // for highlights the same as for stories; an explicit caller username still wins.
  const owner = username ?? reel?.user?.username ?? null;
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
      return url ? withItemMeta(
        {
          url,
          type: 'video',
          filename: `story_${base.pk}`,
          index: base.index,
          pk: base.pk,
          id: base.id,
        },
        { postId: base.pk, username: owner },
      ) : null;
    }
    const url = pickBestCandidate(it?.image_versions2?.candidates);
    return url ? withItemMeta(
      {
        url,
        type: 'image',
        filename: `story_${base.pk}`,
        index: base.index,
        pk: base.pk,
        id: base.id,
      },
      { postId: base.pk, username: owner },
    ) : null;
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
    return one ? [withItemMeta(
      { url: one.url, type: one.type, filename: one.filename, index: one.index },
      one.meta || {},
    )] : [];
  }
  return mapped.map((m) => withItemMeta(
    { url: m.url, type: m.type, filename: m.filename, index: m.index },
    m.meta || {},
  ));
}

// Map an Instagram API HTTP status to a user-facing message. Thin adapter over
// the shared classifier (common.js) so Instagram speaks the same vocabulary the
// other platforms will as they move onto it. All of these are resolver-phase
// failures (page -> media URL); the returned retry verdict is discarded here
// until the download loop consumes it. See issue #20.
export function mapIgStatusToMessage(status) {
  return classifyFailure({
    platform: 'instagram',
    outcome: { kind: 'http', status },
  }).message;
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
