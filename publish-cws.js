// SocialSnag - Chrome Web Store publish
//
// Uploads the built zip to the store item and publishes it through the
// Chrome Web Store API v2 (chromewebstore.googleapis.com). v1 is deprecated
// and shuts off 2026-10-15, so this targets v2 only. v2 requires the
// publisher id in every path, which v1 did not.
//
// Credentials come from the environment and are never committed. See
// docs/cws-publishing.md for the one-time OAuth setup.
//
// The upload targets the repo's package.json "cws.itemId" (CWS_ITEM_ID
// overrides it). One publisher credential set manages every extension the
// account owns, so copying this script into another extension repo and setting
// that repo's cws.itemId is all it needs to publish a different extension.
//
// Usage:
//   npm run publish:cws                    upload the version's zip, then publish
//   npm run publish:cws -- --skip-publish  upload only (publish later from the dashboard)
//   npm run publish:cws -- some/build.zip  upload a specific zip

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com';
const REQUIRED_ENV = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID'];

// --- Pure helpers (exported for testing) ---

// The upload response reports uploadState. v2 uses SUCCEEDED/FAILED where v1
// used SUCCESS/FAILURE; checking the wrong spelling silently never matches, so
// the check lives here and is tested against both spellings.
export function interpretUploadState(json) {
  const state = json?.uploadState || '';
  if (state === 'SUCCEEDED') return { ok: true, inProgress: false };
  if (state.includes('IN_PROGRESS')) return { ok: false, inProgress: true };
  const detail = (json?.itemError || [])
    .map((e) => e.error_detail || e.errorDetail || JSON.stringify(e))
    .join('; ');
  return { ok: false, inProgress: false, message: detail || `upload state: ${state || 'unknown'}` };
}

// A large upload finishes asynchronously: the upload response reports IN_PROGRESS
// (Google's upload-response docs also call this UPLOAD_IN_PROGRESS; the substring
// check in interpretUploadState matches either) instead of a final state. The v2
// :fetchStatus method reports the settled result of that async upload in
// lastAsyncUploadState: the same UploadState enum (UPLOAD_STATE_UNSPECIFIED /
// SUCCEEDED / IN_PROGRESS / FAILED / NOT_FOUND) the upload response puts in
// uploadState, just under a different field name. So the poll interpreter maps that
// field onto uploadState and reuses interpretUploadState rather than re-encoding the
// enum handling. Verified against the v2 discovery doc: GET
// publishers/{p}/items/{i}:fetchStatus, state in lastAsyncUploadState (NOT
// uploadState). See docs/cws-publishing.md.
export function interpretUploadStatus(json) {
  return interpretUploadState({
    uploadState: json?.lastAsyncUploadState,
    itemError: json?.itemError,
  });
}

// Bounded exponential backoff: attempt 0 waits baseDelayMs, each later attempt
// doubles up to maxDelayMs. A slow upload is polled patiently without hammering the
// API and without a fixed long wait. Pure, so the schedule is tested directly.
export function backoffDelayMs(attempt, baseDelayMs, maxDelayMs) {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

// Whether a failed status check is worth retrying while polling. A 5xx or a 429
// rate-limit is transient: the store may just be busy while the upload settles, so
// keep polling. A network-level failure (fetch rejects with no HTTP status) is also
// transient. A terminal 4xx (401 revoked/expired token, 403 permissions, 404 bad
// item id) is not: retrying it just delays an actionable error behind the ~2m poll
// budget, so surface it right away.
export function isRetryableStatusError(err) {
  const status = err?.status;
  if (typeof status !== 'number') return true; // no HTTP response: a network blip
  return status === 429 || status >= 500;
}

// Poll `getStatus` until the upload settles (ok, or a non-in-progress failure) or the
// attempt budget is spent. `getStatus` returns an interpretUploadState-shaped result;
// `sleep` and `onWait` are injected so the loop is unit-testable with no network or
// real clock. A status check that throws a retryable error (`isRetryable`, e.g. a
// transient 5xx/429 while the store is still processing) must not abort a publish
// whose upload is fine: it is treated like "still in progress" and polling continues
// within the same budget. A non-retryable error (a terminal 4xx) is re-thrown so its
// actionable cause surfaces at once. A successful check clears a prior retryable error,
// so if the budget runs out the message distinguishes a genuine timeout from a trailing
// run of status-check failures instead of hiding the latter. `isRetryable` defaults to
// retrying everything, so callers that never throw are unaffected.
export async function pollUntilSettled(getStatus, { attempts, baseDelayMs, maxDelayMs, sleep, onWait = () => {}, isRetryable = () => true }) {
  let waitedMs = 0;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const delay = backoffDelayMs(attempt, baseDelayMs, maxDelayMs);
    await sleep(delay);
    waitedMs += delay;
    let status;
    try {
      status = await getStatus();
    } catch (err) {
      if (!isRetryable(err)) throw err; // terminal: fail fast with the real cause
      lastError = err;
      onWait(waitedMs);
      continue;
    }
    lastError = null;
    if (!status.inProgress) return status;
    onWait(waitedMs);
  }
  const waitedS = Math.round(waitedMs / 1000);
  const suffix = lastError
    ? `; the last status check failed: ${lastError.message}`
    : '. Re-run, or publish from the dashboard, once it settles.';
  return {
    ok: false,
    inProgress: true,
    message: `upload still processing after ${attempts} status checks (~${waitedS}s)${suffix}`,
  };
}

// The publish response reports state. Only the known v2 success states confirm
// a publish: PENDING_REVIEW (the normal update path), PUBLISHED, STAGED, and
// PUBLISHED_TO_TESTERS. Everything else, an empty body, ITEM_STATE_UNSPECIFIED,
// REJECTED/CANCELLED, or a state we do not recognize, returns ok:false so the
// script never claims a release that did not happen. A new success state Google
// adds later reads as "not confirmed" (check the dashboard), the safe direction.
const PUBLISH_OK_STATES = new Set(['PENDING_REVIEW', 'PUBLISHED', 'STAGED', 'PUBLISHED_TO_TESTERS']);

export function interpretPublishState(json) {
  const state = json?.state || '';
  const warnings = (json?.warningInfo?.warnings || []).map((w) => w.warningDetail || JSON.stringify(w));
  return { ok: PUBLISH_OK_STATES.has(state), state: state || 'unknown', warnings };
}

export function resolveZipPath(args, name, version) {
  const explicit = args.find((a) => a.endsWith('.zip'));
  return explicit || `${name}-${version}.zip`;
}

// Which store listing receives the upload. CWS_ITEM_ID from the environment
// wins (a one-off override, or any checkout without repo config), then the
// repo's own package.json "cws.itemId". No baked-in default on purpose: a
// hardcoded id would let this script silently publish one repo's build to a
// different extension when the config is missing. Absent in both places is a
// hard error, not a guess.
export function resolveItemId(envItemId, pkg) {
  const id = envItemId || pkg?.cws?.itemId;
  if (!id) {
    throw new Error(
      'no store item id: set CWS_ITEM_ID or add "cws": { "itemId": "..." } to package.json. See docs/cws-publishing.md',
    );
  }
  return id;
}

// --- Network ---

async function getAccessToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // invalid_grant here usually means the refresh token expired: a
    // testing-mode OAuth consent screen kills it after 7 days. See the doc.
    const reason = json.error_description || json.error || 'no access_token in response';
    throw new Error(`token refresh failed (${res.status}): ${reason}`);
  }
  return json.access_token;
}

async function uploadZip(token, env, zipBytes) {
  const url = `${API}/upload/v2/publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_ITEM_ID}:upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: zipBytes,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload request failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET publishers/{p}/items/{i}:fetchStatus, the async upload's settled state.
// v2 method (v1 had no equivalent); the state is in lastAsyncUploadState, read by
// interpretUploadStatus. Body is empty; the item is named entirely in the path.
async function fetchItemStatus(token, env) {
  const url = `${API}/v2/publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_ITEM_ID}:fetchStatus`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Attach the HTTP status so the poll can tell a transient blip (5xx/429) from a
    // terminal error (401 revoked token, 403 permissions, 404 bad item id) and stop
    // retrying the latter. See isRetryableStatusError.
    const err = new Error(`status request failed (${res.status}): ${JSON.stringify(json)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function publishItem(token, env) {
  const url = `${API}/v2/publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_ITEM_ID}:publish`;
  // v2 publish body fields are all optional, and no field selects the release
  // channel (public vs trusted testers): that comes from the dashboard's saved
  // visibility. publishType DEFAULT_PUBLISH means publish immediately after
  // review, which is the documented default; sending it explicitly keeps the
  // intent legible without changing behavior. (v1 used a ?publishTarget= query
  // param; v2 does not.)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`publish request failed (${res.status}): ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const skipPublish = args.includes('--skip-publish');

  const env = {};
  const missing = [];
  for (const key of REQUIRED_ENV) {
    env[key] = process.env[key];
    if (!env[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`missing env: ${missing.join(', ')}. See docs/cws-publishing.md`);
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  env.CWS_ITEM_ID = resolveItemId(process.env.CWS_ITEM_ID, pkg);
  // Surface the one situation that would publish to the wrong extension: an
  // env override that disagrees with the repo's declared id.
  if (process.env.CWS_ITEM_ID && pkg?.cws?.itemId && process.env.CWS_ITEM_ID !== pkg.cws.itemId) {
    console.log(`note: CWS_ITEM_ID overrides package.json cws.itemId (${pkg.cws.itemId} -> ${process.env.CWS_ITEM_ID})`);
  }

  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const zipPath = resolveZipPath(args, pkg.name, manifest.version);
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found: ${zipPath}. Run "npm run build:zip" first.`);
  }

  console.log(`item ${env.CWS_ITEM_ID}, version ${manifest.version}, zip ${zipPath}`);
  const token = await getAccessToken(env);

  const uploadJson = await uploadZip(token, env, await readFile(zipPath));
  let upload = interpretUploadState(uploadJson);
  if (upload.inProgress) {
    // A larger zip uploads asynchronously: the store reports the upload as still
    // in progress and finishes in the background. Rather than abort and make the
    // caller re-run (the old behavior), poll :fetchStatus with bounded backoff
    // until it settles, then fall through to the same ok/failure checks. The
    // budget (8 attempts, ~2m of backoff) bounds a hung upload instead of waiting
    // forever; on exhaustion it throws with guidance rather than a false success.
    console.log('upload processing asynchronously on the store side; polling until it settles...');
    upload = await pollUntilSettled(
      async () => interpretUploadStatus(await fetchItemStatus(token, env)),
      {
        attempts: 8,
        baseDelayMs: 2000,
        maxDelayMs: 20000,
        sleep,
        onWait: (ms) => console.log(`  still processing after ~${Math.round(ms / 1000)}s...`),
        isRetryable: isRetryableStatusError,
      },
    );
    if (upload.inProgress) throw new Error(upload.message); // budget spent, still not done
  }
  if (!upload.ok) throw new Error(`upload rejected: ${upload.message}`);
  console.log(`uploaded version ${uploadJson.crxVersion || manifest.version}`);

  if (skipPublish) {
    console.log('skip-publish set: uploaded but not published. Publish from the dashboard when ready.');
    return;
  }

  const publish = interpretPublishState(await publishItem(token, env));
  for (const w of publish.warnings) console.log(`warning: ${w}`);
  if (!publish.ok) throw new Error(`publish not confirmed (state ${publish.state}); check the dashboard`);
  console.log(`published: state ${publish.state}`);
  console.log('Updates pass through Google review before going live; watch the dashboard.');
}

// Run main() only when invoked directly (node publish-cws.js / npm run
// publish:cws), not when a test imports the pure helpers. Compare file URLs so
// a relative argv[1] still resolves to this module's absolute URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
