# Privacy policy

*Last updated: 2026-07-22*

SocialSnag is a browser extension that downloads media from Instagram, Twitter/X, Facebook, and Bluesky. You can use it from the right-click menu on a supported site or submit a direct post link through the SocialSnag GitHub Pages site. Both workflows resolve and download media inside your browser. When platform access is required, the extension uses the account session already signed in to that browser. Requests go directly to the selected social platform and its media hosts. SocialSnag has no developer-operated backend or intermediary service. Building a .zip archive and copying a media URL to the clipboard also happen locally inside the extension.

## Data stored by the extension

- **Download history** (`chrome.storage.local`): Filename, platform, media type, timestamp, and Chrome download ID for each successful download, up to 50 entries. Download history does not contain media URLs and is not synced.
- **User preferences** (`chrome.storage.sync`): Enabled platforms, notification setting, download path, .zip preference, advanced mode, and resolver debug setting. Chrome may sync these settings through the signed-in browser account.
- **Advanced-mode captures** (`chrome.storage.session`): Media URL, browser request type, and timestamp, up to 50 entries per tab. These entries are held in browser session storage and removed when the tab closes.
- **Pending .zip cleanup** (`chrome.storage.session`): A locally created blob URL keyed by its Chrome download ID while a .zip download is active. The entry is removed when the download completes, is erased, or can no longer resume.

## Developer and server boundary

SocialSnag has no developer-operated backend. It does not send the following to a SocialSnag server or another developer-operated server:

- Browsing history
- Account data or browser cookies
- Submitted post URLs
- Download history or preferences
- Analytics or telemetry
- Tracking data of any kind

There are no analytics scripts, no remote logging, and no usage tracking.

## Landing-page post links

The GitHub Pages form is a static interface for the installed extension. It sends the submitted post URL directly to that extension through Chrome's runtime messaging. SocialSnag does not write submitted URLs to extension storage or send them to a SocialSnag server or another developer-operated server. The submitted value remains visible in the form until you change it or close the page.

Instagram submissions are resolved through direct platform API requests. X/Twitter, Facebook, and Bluesky submissions may load in a temporary inactive browser tab. That tab uses the browser's existing signed-in session and normal platform network behavior. Normal browser cache and history behavior may apply when a platform page loads. The extension closes the temporary tab when resolution finishes or fails.

Only a small result returns to the GitHub Pages site: success or failure, the supported platform name, and the number of downloads that started. Resolved CDN URLs, page content, cookies, and account data do not return to the page. If the extension cannot proceed because the user is logged out, lacks access, the post is private, expired, or deleted, the platform is rate-limiting requests, or the link is unsupported, the form shows a visible failure state.

## Third-party sharing

SocialSnag does not send data to a SocialSnag server or another developer-operated server. User-initiated downloads contact the selected social platform and its media hosts directly so the extension can resolve and download the requested media. Those platform requests use the browser's normal network and account session where needed.

## Right-click workflow

SocialSnag uses the `activeTab` permission to access page content when you right-click on a supported site. This access is triggered only by your right-click action. The extension reads only the page data needed to resolve media. It does not store, log, or send that page content to SocialSnag.

## User control

- **Clear download history:** Open the SocialSnag popup and click the clear button.
- **Disable platforms:** Toggle individual platforms on or off from the popup or options page.
- **Remove all data:** Uninstall the extension. Chrome deletes all associated local storage.

## Contact

Questions or concerns: [open an issue on GitHub](https://github.com/jamditis/socialsnag/issues).
