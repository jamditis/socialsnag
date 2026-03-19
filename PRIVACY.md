# Privacy policy

SocialSnag is a browser extension that downloads media from social platforms. It is designed to keep your data on your device and nowhere else.

## What data is collected

- **Download history:** Filenames, timestamps, and platform names for each download. Stored locally on your device using Chrome's storage API.
- **User preferences:** Enabled platforms, notification settings, and advanced mode toggle. Stored locally using Chrome's sync storage.

## What data is not collected

SocialSnag does not collect, store, or transmit:

- Browsing history
- Personal information
- Analytics or telemetry
- Tracking data of any kind

There are no analytics scripts, no remote logging, and no usage tracking.

## Where data is stored

All data stays on your device. Download history is stored in Chrome's local storage. Preferences are stored in Chrome's sync storage (synced only between your own Chrome instances, managed by Google — SocialSnag has no server component).

No data leaves your device to any server controlled by SocialSnag.

## Third-party sharing

None. SocialSnag does not transmit data to external servers. There is no backend, no API, and no third-party integrations.

## How activeTab works

SocialSnag uses the `activeTab` permission to access page content when you right-click on a supported site. This access is triggered only by your action (the right-click). The extension reads only media URLs from the page — it does not store, log, or transmit any page content.

## User control

- **Clear download history:** Open the SocialSnag popup and click the clear button.
- **Disable platforms:** Toggle individual platforms on or off from the popup or options page.
- **Remove all data:** Uninstall the extension. Chrome deletes all associated local storage.

## Contact

Questions or concerns: [open an issue on GitHub](https://github.com/jamditis/socialsnag/issues).
