// SocialSnag common utilities

// Allowlist of CDN domains we trust for downloads
export const ALLOWED_DOMAINS = [
  'cdninstagram.com',
  'pbs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
  'cdn.bsky.app',
  'video.bsky.app',
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

// One vocabulary for both the folder template and the filename template, so a
// token means the same thing wherever it is written and the options page has one
// list to document.
//
// Every token is optional at render time. A post with no id, a platform that does
// not expose a username, a single-item download with no index: all of those are
// normal, so a template naming them has to survive them being absent rather than
// rendering "undefined" into a filename the user then has to clean up.
export const TEMPLATE_TOKENS = [
  'platform',
  'type',
  'postId',
  'username',
  'index',
  'date',
];

// The caller supplies these for every item, so a template containing one can never
// render empty. The rest depend on the post: an id the resolver could not find, a
// platform with no username in the DOM, a single download with no index.
export const ALWAYS_PRESENT_TOKENS = ['platform', 'type', 'date'];

/**
 * Render a template against a field bag.
 *
 * A token whose field is missing renders as nothing and takes the one separator
 * that follows it, so a missing field costs its own segment and nothing more:
 * `{postId}_{index}` on a post with no id renders `1`, not `_1`.
 *
 * Path separators are left in place. Whether they are legal is the caller's call --
 * they are in a folder template and are not in a filename -- and that belongs with
 * the caller's validation rather than duplicated here.
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
    if (dropSeparator && /^[_\-\s]+$/.test(part.literal)) {
      dropSeparator = false;
      continue;
    }
    dropSeparator = false;
    out.push(part.literal);
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
 * @param {{allowSlash?: boolean}} [options] folder templates may nest, filenames may not
 * @returns {{valid: true} | {valid: false, reason: string}}
 */
export function validateTemplate(template, options = {}) {
  if (typeof template !== 'string' || template.trim() === '') {
    return { valid: false, reason: 'Template is empty.' };
  }

  const unknown = [
    ...new Set(
      Array.from(template.matchAll(/\{([^}]*)\}/g))
        .map((m) => m[1])
        .filter((name) => !TEMPLATE_TOKENS.includes(name)),
    ),
  ];
  if (unknown.length > 0) {
    const wrote = unknown.map((u) => `{${u}}`).join(', ');
    const available = TEMPLATE_TOKENS.map((t) => `{${t}}`).join(', ');
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
