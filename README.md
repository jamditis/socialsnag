![Version](https://img.shields.io/github/v/release/jamditis/socialsnag)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/llbpeneloehnlaomolbalbmhjncpmnfa)](https://chromewebstore.google.com/detail/socialsnag/llbpeneloehnlaomolbalbmhjncpmnfa)
![License](https://img.shields.io/github/license/jamditis/socialsnag)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![Chrome](https://img.shields.io/badge/chrome-116%2B-yellow)

# SocialSnag

Download full-resolution images and videos from social media. Right-click while browsing a supported site, or paste a direct post link into the landing page.

**[View the landing page](https://jamditis.github.io/socialsnag/)**

![SocialSnag](og-image.png)

## Two ways to download

**Right-click while browsing:** Open a supported post, right-click its media, and choose a SocialSnag action from the context menu.

**Paste a post link:** After the supporting extension update is live in the Chrome Web Store, install or update to that current SocialSnag release. Then open the [SocialSnag landing page](https://jamditis.github.io/socialsnag/), paste a direct Instagram, X/Twitter, Facebook, or Bluesky post link, and select **Download media**. The static page delegates the request to that locally installed extension. The extension resolves and downloads the media in your browser, using the platform accounts already signed in to that browser when access is required.

The landing page has no backend. It receives a result containing only the platform, download count, and success or failure status. Resolved CDN URLs and account data stay inside the browser extension. Unsupported links, logged-out sessions, private or inaccessible posts, expired or deleted posts, and rate limits produce a visible failure message.

The GitHub Pages site deployment and the Chrome Web Store extension update are separate release gates. The pasted-link workflow is available only after both releases are live and the current extension release that supports submitted URLs is installed. An older installed version does not support the form. Right-click use continues to work independently from the landing-page form.

## Features

- **Right-click download:** Use the context menu on any supported page
- **Direct post-link download:** Paste a supported post link into the landing page and delegate the download to the installed extension
- **HD quality** — rewrites CDN URLs to fetch the highest available resolution
- **Multi-image posts** — download every slide of an Instagram carousel, in order, resolved through Instagram's media API
- **Instagram stories** — download the story you're viewing, or the user's whole active tray
- **Video downloads** — Instagram reels and Twitter/X videos via platform API resolution
- **Copy media URL** — copy the full-resolution URL to your clipboard instead of downloading
- **Zip downloads** — bundle a carousel or story into a single .zip, as a default or per download
- **Download history** — track recent downloads from the popup
- **Organized folders** — files saved to `SocialSnag/<platform>/` automatically
- **Platform toggles** — enable or disable individual platforms from settings
- **Configurable download path** — choose where files are saved within your Downloads folder

## Supported platforms

- Instagram (images, reels, carousels, stories)
- Twitter/X (images, profile pictures, videos)
- Facebook (images, videos)
- Bluesky (images)

## Install

### Chrome Web Store

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/socialsnag/llbpeneloehnlaomolbalbmhjncpmnfa)**

### Developer mode

1. Clone and build:
   ```
   git clone https://github.com/jamditis/socialsnag.git
   cd socialsnag
   npm install && npm run build
   ```
2. Open `chrome://extensions` in your browser
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `dist/` folder
5. Navigate to a supported site and right-click any image or video

## Privacy

SocialSnag stores preferences and download history in Chrome and has no custom server component. Some non-sensitive settings, such as platform toggles and advanced mode, use Chrome's sync storage and may be synced via Google if Chrome Sync is enabled in your browser. The landing page does not log or store submitted post URLs, and it never receives resolved CDN URLs or account data from the extension. SocialSnag does not collect analytics, telemetry, or personal information. See the [privacy policy](https://jamditis.github.io/socialsnag/privacy.html) for details.

## License

MIT. See [LICENSE](LICENSE).
