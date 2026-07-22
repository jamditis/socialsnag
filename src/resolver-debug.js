// SocialSnag — opt-in resolver debug tracing (pure, testable)
//
// When a resolver comes back empty there is currently no way to tell which path ran
// (API, DOM, captured-request fallback) or what the server said. That is the whole
// of issue #25: make the decision visible without making it noisy, and without ever
// writing a CDN URL anywhere.
//
// Two rules shape everything here:
//
//   1. Opt-in. Silence is the default. Nothing below runs, and nothing reaches the
//      console, unless the user turns the toggle on in options.
//   2. No URLs, ever. SocialSnag's privacy promise is that media URLs are not
//      persisted or logged, and a debug mode is exactly where that promise gets
//      broken by accident -- someone logs the response for one bug and it ships.
//      So the formatter does not take a URL parameter at all, and redacts anything
//      URL-shaped that reaches it anyway. A caller cannot leak by mistake, only by
//      deliberately defeating the redaction, which is the difference between a rule
//      and a guardrail.
//
// Statuses are reported as buckets rather than exact codes. A bucket is what a
// person debugging actually reasons about ("it's 4xx, I'm logged out"), and it
// keeps the log from becoming a per-request trace of someone's browsing.

export const DEBUG_SETTING_KEY = 'resolverDebug';

/**
 * Bucket an HTTP status for logging: '2xx', '4xx', '429', '5xx', or 'network'.
 *
 * 429 is split out of 4xx on purpose -- rate limiting is the single most common
 * cause of a resolver silently returning nothing, and it is the one case where the
 * right advice is "wait", not "log in". A 0, null, or undefined status means the
 * request never got a response at all, which reads as 'network'.
 */
export function statusBucket(status) {
  if (typeof status !== 'number' || !Number.isFinite(status) || status <= 0) return 'network';
  if (status === 429) return '429';
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 200 && status < 300) return '2xx';
  return 'other';
}

// Anything that looks like a URL or a bare CDN host. Deliberately broad: this is a
// backstop against a careless caller, so a false redaction is cheap and a miss is not.
// The word-boundary anchor belongs only on the bare-host alternative. Leading it
// across the whole group would stop the protocol-relative form matching at all,
// because `//` opens with a non-word character and there is no boundary to find.
//
// The bare-host arm takes any dotted host rather than a fixed list of TLDs. A list
// has to be kept in step with the download allowlist and silently stops redacting
// the day a platform is added -- cdn.bsky.app and video.bsky.app are already
// allowed download hosts that a `com|net|org|io|co` list would have missed. The
// cost is that a dotted token like a filename gets redacted too, which is the
// direction to fail in.
const URL_SHAPED =
  /[a-z][a-z0-9+.-]*:\/\/\S+|\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi;

/** Replace anything URL-shaped with a marker, so a leak shows up instead of shipping. */
export function redactUrls(value) {
  return String(value).replace(URL_SHAPED, '[url removed]');
}

/**
 * Format one resolver decision as a log line.
 *
 * Takes structured fields, never a URL. `detail` exists for the odd extra fact (a
 * shortcode, a count) and is redacted before it is used, so the no-URL rule holds
 * even when a caller passes something it should not have.
 *
 *   socialsnag[instagram] story-api: empty (429, 0 items)
 */
export function formatTrace({ platform, path, outcome, status, itemCount, detail } = {}) {
  const facts = [];
  if (status !== undefined) facts.push(statusBucket(status));
  if (typeof itemCount === 'number') facts.push(`${itemCount} item${itemCount === 1 ? '' : 's'}`);
  if (detail) facts.push(redactUrls(detail));

  const head = `socialsnag[${platform || 'unknown'}] ${path || 'unknown'}: ${outcome || 'unknown'}`;
  return facts.length ? `${head} (${facts.join(', ')})` : head;
}

/**
 * Build a trace logger bound to the user's current setting.
 *
 * Reads the toggle once per call rather than caching it, so turning debug on takes
 * effect on the next download instead of after a reload -- the person flipping it is
 * mid-bug-hunt and should not have to guess whether it took. `storage` and `logger`
 * are injected so this is testable without a browser.
 */
export function createTracer({ storage, logger = console } = {}) {
  return async function trace(fields) {
    if (!storage?.sync?.get) return false;
    let enabled = false;
    try {
      const items = await storage.sync.get({ [DEBUG_SETTING_KEY]: false });
      enabled = Boolean(items?.[DEBUG_SETTING_KEY]);
    } catch {
      // A storage read that fails must not take a download with it. Debug output is
      // the least important thing happening; stay quiet and let the resolver run.
      return false;
    }
    if (!enabled) return false;
    logger.log(formatTrace(fields));
    return true;
  };
}
