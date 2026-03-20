![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/github/license/jamditis/socialsnag)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![Chrome](https://img.shields.io/badge/chrome-116%2B-yellow)

# SocialSnag

Right-click to download full-resolution images and videos from social media.

**[View the landing page](https://jamditis.github.io/socialsnag/)**

![SocialSnag](og-image.png)

## Features

- **Right-click download** — context menu on any supported page, no copy-pasting URLs
- **HD quality** — rewrites CDN URLs to fetch the highest available resolution
- **Multi-image posts** — download all media from a carousel or gallery in one click
- **Download history** — track recent downloads from the popup
- **Organized folders** — files saved to `SocialSnag/<platform>/` automatically
- **Platform toggles** — enable or disable individual platforms from the popup or options page

## Supported platforms

- Instagram
- Twitter/X
- Facebook

## Install

### Chrome Web Store

Coming soon.

### Developer mode

1. Clone this repo:
   ```
   git clone https://github.com/jamditis/socialsnag.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the cloned `socialsnag` folder
5. Navigate to a supported site and right-click any image or video

## Privacy

SocialSnag stores data locally in your browser and has no server component. The extension does not collect analytics, telemetry, or personal information. See [PRIVACY.md](PRIVACY.md) for details.

## License

MIT. See [LICENSE](LICENSE).
