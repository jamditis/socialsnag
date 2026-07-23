# Privacy policy

*Last updated: 2026-07-22*

SocialSnag is a browser extension that downloads media from Instagram, Twitter/X, Facebook, and Bluesky. You can use it from the right-click menu on a supported site or submit a direct post link through the SocialSnag GitHub Pages site. Both workflows resolve and download media inside your browser. When platform access is required, the extension uses the account session already signed in to that browser. Requests go directly to the selected social platform and its media hosts. SocialSnag has no backend or intermediary service. Building a .zip archive and copying a media URL to the clipboard also happen locally inside the extension.

## What data is collected

- **Download history:** Filenames, timestamps, and platform names for each download. Stored locally on your device using Chrome's storage API.
- **User preferences:** Enabled platforms, notification settings, and advanced mode toggle. Stored locally using Chrome's sync storage.

## What data is not collected

SocialSnag does not collect or store:

- Browsing history
- Personal information
- Analytics or telemetry
- Tracking data of any kind
- Post URLs submitted through the GitHub Pages site

There are no analytics scripts, no remote logging, and no usage tracking.

## Where data is stored

User preferences are stored via Chrome's sync storage, which may be synced to Google's servers according to your browser settings. Download history is stored locally and is not synced. A submitted post URL is held only long enough for the installed extension to process the request. It is not added to SocialSnag storage or sent to a SocialSnag server.

## Landing-page post links

The GitHub Pages form is a static interface for the installed extension. It sends the submitted post URL directly to that extension through Chrome's runtime messaging. The extension may contact the selected platform or open the submitted post in an inactive browser tab to resolve media with the browser's existing signed-in session.

Only a small result returns to the page: success or failure, the supported platform name, and the number of downloads that started. Resolved CDN URLs, page content, cookies, and account data do not return to the GitHub Pages site. If the extension cannot proceed because the user is logged out, lacks access, the post is private, expired, or deleted, the platform is rate-limiting requests, or the link is unsupported, the form shows a visible failure state.

## Third-party sharing

SocialSnag does not send data to a SocialSnag server or an intermediary service. User-initiated downloads contact the selected social platform and its media hosts directly so the extension can resolve and download the requested media. Those platform requests use the browser's normal network and account session where needed.

## Right-click workflow

SocialSnag uses the `activeTab` permission to access page content when you right-click on a supported site. This access is triggered only by your right-click action. The extension reads only the page data needed to resolve media. It does not store, log, or send that page content to SocialSnag.

## User control

- **Clear download history:** Open the SocialSnag popup and click the clear button.
- **Disable platforms:** Toggle individual platforms on or off from the popup or options page.
- **Remove all data:** Uninstall the extension. Chrome deletes all associated local storage.

## Contact

Questions or concerns: [open an issue on GitHub](https://github.com/jamditis/socialsnag/issues).
