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
// Usage:
//   npm run publish:cws                    upload the version's zip, then publish
//   npm run publish:cws -- --skip-publish  upload only (publish later from the dashboard)
//   npm run publish:cws -- some/build.zip  upload a specific zip

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com';
const DEFAULT_ITEM_ID = 'llbpeneloehnlaomolbalbmhjncpmnfa';
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

export function resolveZipPath(args, version) {
  const explicit = args.find((a) => a.endsWith('.zip'));
  return explicit || `socialsnag-${version}.zip`;
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

  const env = { CWS_ITEM_ID: process.env.CWS_ITEM_ID || DEFAULT_ITEM_ID };
  const missing = [];
  for (const key of REQUIRED_ENV) {
    env[key] = process.env[key];
    if (!env[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`missing env: ${missing.join(', ')}. See docs/cws-publishing.md`);
  }

  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const zipPath = resolveZipPath(args, manifest.version);
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found: ${zipPath}. Run "npm run build:zip" first.`);
  }

  console.log(`item ${env.CWS_ITEM_ID}, version ${manifest.version}, zip ${zipPath}`);
  const token = await getAccessToken(env);

  const uploadJson = await uploadZip(token, env, await readFile(zipPath));
  const upload = interpretUploadState(uploadJson);
  if (upload.inProgress) {
    throw new Error('upload still processing on the store side. Wait a minute and re-run, or publish from the dashboard.');
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
