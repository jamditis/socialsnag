// SocialSnag common utilities

// Allowlist of CDN domains we trust for downloads
export const ALLOWED_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
  'cdn.bsky.app',
  'video.bsky.app',
  // LinkedIn is an optional platform: the host permission gates whether its
  // resolver ever runs, but a URL it produces still has to pass this allowlist.
  'media.licdn.com',
];

// True if url's hostname is exactly `host` or a subdomain of it. False for an
// unparseable URL. Hostname-based so a CDN string in the path or query
// (e.g. https://evil.com/?u=media.licdn.com/x) cannot pass as a match.
export function hostMatches(url, host) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === host || hostname.endsWith(`.${host}`);
  } catch (e) {
    return false;
  }
}

export function isAllowedDomain(url) {
  return ALLOWED_DOMAINS.some((d) => hostMatches(url, d));
}

export function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

export function sanitizeFilename(name) {
  if (!name) return null;
  return name
    .replace(/\.\.[/\\]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

// --- Filename and folder templates ---

// The token vocabulary. Used by the filename template today; the folder template
// still does its own single-token substitution in sanitizeDownloadPath, and moving
// it onto this list is tracked separately.
//
// Most tokens are optional at render time: a post with no id, a platform that does
// not expose a username. A template naming one has to survive it being absent rather
// than rendering "undefined" into a filename the user then has to clean up.
export const TEMPLATE_TOKENS = [
  'platform',
  'type',
  'postId',
  'username',
  'index',
  'date',
];

// The caller supplies these for every item, so a template containing one can never
// render empty. `index` counts because both download paths pass a position and
// resolveBaseFilename defaults it to 1 -- that guarantee lives in the signature, not
// in a convention a later caller could quietly drop. The rest depend on the post: an
// id the resolver could not find, a platform with no username in the DOM.
export const ALWAYS_PRESENT_TOKENS = ['platform', 'type', 'index', 'date'];

// The tokens the folder actually renders. sanitizeDownloadPath still substitutes
// {platform} only, so the folder field is validated against this subset rather than
// the whole vocabulary: a folder naming {date} or {username} would otherwise save
// clean and then write a literal `{date}` folder to disk. Widen to TEMPLATE_TOKENS
// when the folder moves onto renderTemplate (tracked separately, see above).
export const FOLDER_TOKENS = ['platform'];

/**
 * Render a template against a field bag.
 *
 * A token whose field is missing renders as nothing and takes the separator run
 * directly after it, so a missing field costs its own segment and nothing more:
 * `{postId}_{index}` renders `1`, not `_1`, and `post_{username}_photo` renders
 * `post_photo`, not `post__photo`.
 *
 * Path separators are left in place. Whether they are legal is the caller's call,
 * and that belongs with the caller's validation rather than duplicated here. A
 * filename rejects them; a folder template, once it uses this, would not.
 *
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} fields
 * @returns {string} the rendered value, possibly empty
 */
export function renderTemplate(template, fields) {
  if (typeof template !== 'string') return '';

  // Split into literals and tokens rather than substituting in place. The reason is
  // the separator a missing token leaves behind: `{username}_{index}` on a post with
  // no username must render `1`, not `_1`. Knowing which literal followed which
  // token is what makes that decidable, and a blanket "squeeze repeated separators"
  // pass over the finished string cannot tell a gap from a `photo__{index}` the user
  // typed on purpose.
  const parts = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    if (match.index > cursor) parts.push({ literal: template.slice(cursor, match.index) });
    const value = fields?.[match[1]];
    const present = value !== undefined && value !== null && value !== '';
    parts.push({ token: true, present, text: present ? String(value) : '' });
    cursor = match.index + match[0].length;
  }
  if (cursor < template.length) parts.push({ literal: template.slice(cursor) });

  const out = [];
  let dropSeparator = false;
  for (const part of parts) {
    if (part.token) {
      if (part.present) out.push(part.text);
      // A missing token consumes the separator that follows it, and only that one.
      dropSeparator = part.present ? false : true;
      continue;
    }
    // The separator run may BE the literal (`{postId}_{index}`) or merely start it
    // (`post_{username}_photo`), and both are the same gap. Matching only the first
    // shape leaves `post__photo` behind, which the per-segment trim at the end cannot
    // reach because the doubled separator is in the middle of the name.
    const literal = dropSeparator ? part.literal.replace(/^[_\-\s]+/, '') : part.literal;
    dropSeparator = false;
    out.push(literal);
  }

  // Trim per path segment, so a folder template keeps its slashes while a token
  // dropping off either end of a segment does not leave it starting or ending on
  // punctuation.
  return out
    .join('')
    .split('/')
    .map((segment) => segment.replace(/^[_\-\s]+|[_\-\s]+$/g, ''))
    .join('/');
}

/**
 * Check a user-supplied template before it is saved.
 *
 * Unknown tokens are rejected rather than passed through. A user who writes
 * `{postid}` for `{postId}` would otherwise get the literal text `{postid}` in
 * every filename from then on, with nothing to explain why, and the mistake is
 * invisible until they look at their downloads folder.
 *
 * @param {string} template
 * @param {{allowSlash?: boolean, allowedTokens?: string[]}} [options] folder templates
 *   may nest (allowSlash) but render a smaller vocabulary (allowedTokens); filenames
 *   take the whole set and reject slashes. allowedTokens defaults to every token.
 * @returns {{valid: true} | {valid: false, reason: string}}
 */
export function validateTemplate(template, options = {}) {
  // The filename accepts the whole vocabulary; the folder is passed FOLDER_TOKENS
  // because sanitizeDownloadPath renders only those, so a token it would leave literal
  // is rejected here before it is saved rather than surface as a `{date}` folder.
  const allowedTokens = options.allowedTokens || TEMPLATE_TOKENS;
  if (typeof template !== 'string' || template.trim() === '') {
    return { valid: false, reason: 'Template is empty.' };
  }

  // A stray brace changes how every character after it reads, so settle it before
  // naming tokens. Left alone, `photo_{postId` has no `{...}` for the scan below to
  // call unknown, survives as fixed text, and names every download with a literal
  // `{postId` in it -- one keystroke from `{postid}`, which this validator does catch.
  if (/[{}]/.test(template.replace(/\{[^}]*\}/g, ''))) {
    return {
      valid: false,
      reason: 'Unmatched { or }. A token is a name wrapped in both braces, like {postId}.',
    };
  }

  const unknown = [
    ...new Set(
      Array.from(template.matchAll(/\{([^}]*)\}/g))
        .map((m) => m[1])
        .filter((name) => !allowedTokens.includes(name)),
    ),
  ];
  if (unknown.length > 0) {
    const wrote = unknown.map((u) => `{${u}}`).join(', ');
    const available = allowedTokens.map((t) => `{${t}}`).join(', ');
    return {
      valid: false,
      reason: `Unknown token ${wrote}. Available: ${available}. Tokens are case-sensitive.`,
    };
  }

  if (!options.allowSlash && /[/\\]/.test(template)) {
    return {
      valid: false,
      reason:
        'A filename cannot contain / or \\. Use the folder setting above to sort '
        + 'downloads into subfolders.',
    };
  }

  // A template has to render something for every item, or an item supplying none of
  // its tokens produces a file named for nothing but its extension.
  //
  // Ask the renderer rather than re-deriving what counts as fixed text. It trims
  // separators, so the `_` in `{postId}_{index}` is not a name and a rule written
  // here would have to know that -- two statements of one thing, free to drift.
  // Rendering against an empty bag answers it exactly: whatever survives is what a
  // worst-case item would get.
  const survivesWithNoFields = renderTemplate(template, {}) !== '';
  const hasGuaranteedToken = ALWAYS_PRESENT_TOKENS.some((t) => template.includes(`{${t}}`));
  if (!survivesWithNoFields && !hasGuaranteedToken) {
    const guaranteed = ALWAYS_PRESENT_TOKENS.map((t) => `{${t}}`).join(', ');
    return {
      valid: false,
      reason:
        'This can render to nothing. Add some fixed text, or a token that is always '
        + `available (${guaranteed}) -- the others depend on the post.`,
    };
  }

  return { valid: true };
}

/**
 * Decide whether a user-supplied template field is acceptable to save.
 *
 * An empty field is acceptable: it selects the field's default. The filename
 * default keeps each platform's own name, the folder default is
 * `SocialSnag/{platform}`, and both download paths already honor an empty value.
 * validateTemplate rejects an empty string on purpose -- a template that must
 * render a name cannot be blank -- so the two opt-in options fields ask this
 * instead, then run the shared validator once there is something to check.
 *
 * @param {string} value the raw field value
 * @param {{allowSlash?: boolean}} [options] forwarded to validateTemplate
 * @returns {string|null} the reason to show inline, or null when the value is fine
 */
export function templateFieldError(value, options = {}) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const result = validateTemplate(value, options);
  return result.valid ? null : result.reason;
}

export function extractId(url, pattern) {
  const match = url.match(pattern);
  return match ? match[1] : null;
}

export function findPostContainer(element, selectors) {
  let el = element;
  const body = globalThis.document?.body;
  while (el && el !== body) {
    for (const selector of selectors) {
      if (el.matches(selector)) return el;
    }
    el = el.parentElement;
  }
  return null;
}

// An <img> is content rather than chrome when it is big enough to be worth saving.
// A post container holds more than the post's media: the author's avatar, a company
// logo, and reaction icons all come from the same CDN, so a sweep that keys only on
// the CDN host saves them alongside the photos.
//
// A zero or absent width means the element has not laid out yet, which is common for
// images below the fold, so that case is kept rather than guessed away.
export function isContentSized(img) {
  return img.width > 50 || img.naturalWidth > 50 || !img.width;
}

export function collectMediaInContainer(container) {
  const items = [];
  if (!container) return items;

  container.querySelectorAll('img').forEach((img) => {
    const src = img.src || img.dataset.src || '';
    if (src && !src.startsWith('data:')) {
      items.push({ url: src, type: 'image', element: img });
    }
  });

  container.querySelectorAll('video').forEach((video) => {
    const src = video.src || video.querySelector('source')?.src || '';
    if (src && !src.startsWith('blob:')) {
      items.push({ url: src, type: 'video', element: video });
    }
  });

  return items;
}

export function findNearestMedia(element) {
  if (!element) return null;

  // Check if the target itself is media
  if (element.tagName === 'IMG') return element;
  if (element.tagName === 'VIDEO') return element;

  // Check children (click on overlay div containing an img)
  const img = element.querySelector('img');
  if (img) return img;
  const video = element.querySelector('video');
  if (video) return video;

  // Walk up and check siblings/parent containers
  let el = element;
  const body = globalThis.document?.body;
  for (let i = 0; i < 5 && el && el !== body; i++) {
    el = el.parentElement;
    if (!el) break;
    const nearImg = el.querySelector('img');
    if (nearImg && nearImg.src && !nearImg.src.startsWith('data:')) return nearImg;
    const nearVideo = el.querySelector('video');
    if (nearVideo) return nearVideo;
  }

  return null;
}

export async function getCapturedMedia() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getCapturedMedia' }, (response) => {
      resolve(response?.urls || []);
    });
  });
}

// --- Failure classification (shared across platforms) ---
//
// One decision from one input: given a failed resolve or download, return both
// the user-facing message and whether the failure is worth retrying, so a caller
// can't surface a message while forgetting to decide retryability. See issue #20.

// Display labels match the platform picker in popup.js. A platform with no entry
// falls back to a neutral 'this site' rather than leaking its internal id.
const PLATFORM_LABELS = {
  instagram: 'Instagram',
  twitter: 'Twitter/X',
  facebook: 'Facebook',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || 'this site';
}

// Classify a failed download step into a user-facing message plus a retry verdict.
//
// `outcome` is a discriminated union so a DOM-based platform with no HTTP status
// can't pass a bogus number and inherit an HTTP message it never earned:
//   { kind: 'http', status }    an HTTP status read from a response
//   { kind: 'reason', reason }  a non-HTTP failure: 'login-required' | 'no-media'
// `phase` splits a resolver failure (page -> media URL) from a download failure
// (media URL -> file): a 401/403 means "log in" at the resolver but "the signed
// link expired, refresh" once we already hold a URL and the fetch is rejected.
//
// Returns { message, retry } where retry is 'transient' (server/transport fault,
// safe to retry) or 'terminal' (the user's problem, or unrecoverable — surface now).
//
// Only a 5xx and a 429 are transient. Instagram's resolvers reuse status 0 as an
// "HTTP 200 but parsed to no items" sentinel (an aged-out story, an empty post —
// see background.js), which is NOT a transport failure: it must fall through to
// the terminal generic message, never a "network, try again" prompt for a
// request that will keep coming back empty.
export function classifyFailure({ platform, phase = 'resolve', outcome } = {}) {
  const label = platformLabel(platform);
  const terminal = (message) => ({ message, retry: 'terminal' });
  const transient = (message) => ({ message, retry: 'transient' });

  if (outcome && outcome.kind === 'reason') {
    if (outcome.reason === 'login-required') {
      return terminal(`Log in to ${label} to download this.`);
    }
    // 'no-media' and any unrecognized reason: nothing on the element to grab.
    return terminal('Could not find downloadable media on this element.');
  }

  const status = outcome && outcome.kind === 'http' ? outcome.status : undefined;

  // A 5xx is the server's fault, not the user's, so it earns one retry.
  if (typeof status === 'number' && status >= 500 && status <= 599) {
    return transient(`Network problem reaching ${label}. Try again.`);
  }
  if (status === 429) {
    return transient(`${label} is rate-limiting downloads. Try again in a minute.`);
  }
  if (status === 401 || status === 403) {
    return phase === 'download'
      ? terminal('This media link expired. Refresh the page and try again.')
      : terminal(`Log in to ${label} to download this.`);
  }
  if (status === 404) {
    return terminal(`This ${label} media has expired or was not found.`);
  }
  // Some other status, or none: we got a response but can't use it.
  return terminal(`${label} did not return this media. Try refreshing the page.`);
}
