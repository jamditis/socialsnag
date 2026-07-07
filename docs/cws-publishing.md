# Chrome Web Store publishing

`publish-cws.js` (run via `npm run publish:cws`) uploads the built zip to the
store item and publishes it, using the Chrome Web Store API v2. It does three
things: refresh an access token, upload the zip, then publish the item.

The script reads all credentials from the environment and never stores them.
Keep them in a secret manager or an untracked env file, never in the repo.

## One-time setup

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or
   pick a project and enable the **Chrome Web Store API**.
2. Configure the **OAuth consent screen**. Set its publishing status to **in
   production**, not testing. A testing-mode consent screen expires refresh
   tokens after 7 days, which makes the publish script fail with `invalid_grant`
   a week later. The `chromewebstore` scope is sensitive, so an in-production,
   unverified screen shows an "unverified app" notice you can click through for
   your own account.
3. Create an **OAuth client ID** of type **web application**. Add
   `https://developers.google.com/oauthplayground` as an authorized redirect
   URI. Note the client id and client secret.
4. Get a refresh token with the [OAuth Playground](https://developers.google.com/oauthplayground):
   open the gear menu, tick "use your own OAuth credentials", paste the client id
   and secret, enter the scope `https://www.googleapis.com/auth/chromewebstore`,
   authorize as the developer account that owns the extension, then exchange the
   code for tokens and copy the **refresh token**.
5. Find your **publisher id** in the Chrome Web Store
   [developer dashboard](https://chrome.google.com/webstore/devconsole) under
   account settings. v2 needs it in every API path.
6. The publisher Google account must have **2-step verification** enabled, or
   the store blocks publishing. This is an account setting and does not affect
   the OAuth tokens.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `CWS_CLIENT_ID` | yes | OAuth client id |
| `CWS_CLIENT_SECRET` | yes | OAuth client secret |
| `CWS_REFRESH_TOKEN` | yes | from the OAuth Playground step |
| `CWS_PUBLISHER_ID` | yes | from the developer dashboard |
| `CWS_ITEM_ID` | no | overrides the repo's `package.json` `cws.itemId`; set it only for a one-off target |

## Which store item it targets

The upload goes to one store listing, identified by its item id. The script
resolves it in order: `CWS_ITEM_ID` from the environment first (an override for
a one-off target), then `cws.itemId` in the repo's own `package.json`. There is
no built-in default — if neither is set the script stops with an error rather
than guessing, so a build is never published to the wrong extension.

The `chromewebstore` scope on the refresh token manages every extension the
publisher account owns, so the same four credentials work for all of them. To
publish another extension, copy `publish-cws.js` into its repo, add that repo's
own `cws.itemId` to its `package.json`, and run `npm run publish:cws` there. The
default zip name also follows `package.json` `name` (use a plain, unscoped name
so the zip stays a flat filename), so nothing in the script is SocialSnag-specific.

## Publishing

```bash
npm run build:zip          # produces socialsnag-<version>.zip
# export the CWS_* variables from your secret store here
npm run publish:cws        # upload the zip, then publish
```

Options:

- `npm run publish:cws -- --skip-publish` uploads the zip but does not publish,
  so you can review it in the dashboard and publish there.
- `npm run publish:cws -- some/build.zip` uploads a specific zip instead of the
  one matching the manifest version.

## Notes

- The manifest version must be higher than the currently published version on
  every upload, or the store rejects it.
- Publishing submits the update for Google review. The script reports a
  `PENDING_REVIEW` state and the update goes live after review, not instantly.
- The script targets API v2 (`chromewebstore.googleapis.com`). The older v1 API
  shuts off on 2026-10-15.
