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
