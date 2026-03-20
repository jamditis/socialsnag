// Requires browsers installed separately: npx playwright install chromium
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';

const SCREENSHOT_DIR = resolve('store/screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const WIDTH = 1280;
const HEIGHT = 800;

// Mock HTML pages that simulate social media layouts with context menu overlay

const instagramPage = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #fff; }
  .header { background: #000; border-bottom: 1px solid #262626; padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  .header img { width: 32px; height: 32px; border-radius: 50%; background: #444; }
  .header .user { font-weight: 600; font-size: 14px; }
  .post { max-width: 470px; margin: 20px auto; background: #000; border: 1px solid #262626; border-radius: 8px; }
  .post-image { width: 100%; aspect-ratio: 1; background: linear-gradient(135deg, #405DE6 0%, #833AB4 25%, #E1306C 50%, #F77737 75%, #FCAF45 100%); display: flex; align-items: center; justify-content: center; font-size: 48px; color: rgba(255,255,255,0.3); }
  .actions { padding: 12px 16px; display: flex; gap: 16px; }
  .actions svg { width: 24px; height: 24px; fill: #fff; cursor: pointer; }
  .likes { padding: 0 16px; font-weight: 600; font-size: 14px; }
  .caption { padding: 8px 16px 16px; font-size: 14px; }
  .caption b { font-weight: 600; }
  .nav { background: #000; border-top: 1px solid #262626; position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; text-align: center; color: #666; font-size: 12px; }
  .context-menu { position: absolute; top: 280px; left: 520px; background: #fff; border-radius: 8px; box-shadow: 0 2px 16px rgba(0,0,0,0.3); min-width: 260px; overflow: hidden; z-index: 1000; }
  .context-menu .item { padding: 8px 16px; font-size: 13px; color: #333; cursor: pointer; font-family: -apple-system, sans-serif; }
  .context-menu .item:hover { background: #f0f0f0; }
  .context-menu .separator { border-top: 1px solid #e0e0e0; }
  .context-menu .socialsnag { color: #7c3aed; font-weight: 600; }
</style></head><body>
  <div class="header"><div style="width:32px;height:32px;border-radius:50%;background:#444"></div><span class="user">photography_daily</span></div>
  <div class="post">
    <div class="post-image">Sample post</div>
    <div class="actions">
      <svg viewBox="0 0 24 24"><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938z"/></svg>
      <svg viewBox="0 0 24 24"><path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22z" fill="none" stroke="#fff" stroke-width="2"/></svg>
    </div>
    <div class="likes">2,847 likes</div>
    <div class="caption"><b>photography_daily</b> Golden hour at the coast</div>
  </div>
  <div class="context-menu">
    <div class="item">Back</div>
    <div class="item">Forward</div>
    <div class="item">Reload</div>
    <div class="separator"></div>
    <div class="item">Save image as...</div>
    <div class="item">Copy image</div>
    <div class="separator"></div>
    <div class="item socialsnag">SocialSnag: Download this (HD)</div>
    <div class="item socialsnag">SocialSnag: Download all from post</div>
    <div class="separator"></div>
    <div class="item">Inspect</div>
  </div>
  <div class="nav">instagram.com</div>
</body></html>`;

const twitterPage = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #000; color: #e7e9ea; }
  .sidebar { position: fixed; left: 0; top: 0; width: 68px; height: 100%; background: #000; border-right: 1px solid #2f3336; padding-top: 12px; text-align: center; }
  .sidebar svg { width: 28px; height: 28px; fill: #e7e9ea; margin: 16px auto; display: block; }
  .main { margin-left: 68px; max-width: 600px; border-right: 1px solid #2f3336; min-height: 100vh; }
  .header-bar { padding: 12px 16px; font-size: 20px; font-weight: 700; border-bottom: 1px solid #2f3336; }
  .tweet { padding: 12px 16px; border-bottom: 1px solid #2f3336; }
  .tweet-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: #1d9bf0; }
  .name { font-weight: 700; font-size: 15px; }
  .handle { color: #71767b; font-size: 15px; }
  .tweet-text { font-size: 15px; line-height: 1.4; margin-bottom: 12px; }
  .tweet-image { width: 100%; aspect-ratio: 16/9; background: linear-gradient(135deg, #1a8cd8, #0d47a1); border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 36px; color: rgba(255,255,255,0.3); }
  .tweet-actions { display: flex; gap: 48px; padding: 12px 0; color: #71767b; font-size: 13px; }
  .context-menu { position: absolute; top: 300px; left: 440px; background: #fff; border-radius: 8px; box-shadow: 0 2px 16px rgba(0,0,0,0.3); min-width: 260px; overflow: hidden; z-index: 1000; }
  .context-menu .item { padding: 8px 16px; font-size: 13px; color: #333; cursor: pointer; }
  .context-menu .item:hover { background: #f0f0f0; }
  .context-menu .separator { border-top: 1px solid #e0e0e0; }
  .context-menu .socialsnag { color: #7c3aed; font-weight: 600; }
</style></head><body>
  <div class="sidebar">
    <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  </div>
  <div class="main">
    <div class="header-bar">Home</div>
    <div class="tweet">
      <div class="tweet-header">
        <div class="avatar"></div>
        <div><div class="name">Tech News</div><div class="handle">@technews - 2h</div></div>
      </div>
      <div class="tweet-text">The new chip architecture is here. 40% faster, 30% less power.</div>
      <div class="tweet-image">Sample tweet image</div>
      <div class="tweet-actions">
        <span>42 replies</span>
        <span>1.2K reposts</span>
        <span>8.4K likes</span>
      </div>
    </div>
  </div>
  <div class="context-menu">
    <div class="item">Back</div>
    <div class="item">Forward</div>
    <div class="item">Reload</div>
    <div class="separator"></div>
    <div class="item">Save image as...</div>
    <div class="item">Copy image</div>
    <div class="separator"></div>
    <div class="item socialsnag">SocialSnag: Download this (HD)</div>
    <div class="item socialsnag">SocialSnag: Download all from post</div>
    <div class="separator"></div>
    <div class="item">Inspect</div>
  </div>
</body></html>`;

const popupPage = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: #1a1a2e; display: flex; align-items: flex-start; justify-content: center; padding-top: 80px; min-height: 100vh; font-family: -apple-system, sans-serif; }
  .browser-bar { position: fixed; top: 0; left: 0; right: 0; background: #2d2d44; padding: 8px 16px; display: flex; align-items: center; gap: 8px; }
  .browser-bar .dots { display: flex; gap: 6px; }
  .browser-bar .dot { width: 12px; height: 12px; border-radius: 50%; }
  .browser-bar .dot.r { background: #ff5f57; }
  .browser-bar .dot.y { background: #febc2e; }
  .browser-bar .dot.g { background: #28c840; }
  .browser-bar .url { background: #3d3d5c; border-radius: 20px; padding: 6px 16px; color: #aaa; font-size: 13px; flex: 1; margin: 0 40px; }
  .popup { width: 340px; background: #16213e; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); overflow: hidden; color: #e0e0e0; }
  .popup-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #1a1a3e; }
  .popup-header .left { display: flex; align-items: center; gap: 10px; }
  .popup-header .icon { width: 28px; height: 28px; background: #7c3aed; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 14px; }
  .popup-header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .popup-header .version { font-size: 11px; color: #888; }
  .platforms { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px; }
  .badge { padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
  .badge.ig { background: rgba(225,48,108,0.15); color: #e1306c; }
  .badge.tw { background: rgba(29,155,240,0.15); color: #1d9bf0; }
  .badge.fb { background: rgba(24,119,242,0.15); color: #1877f2; }
  .badge.bs { background: rgba(0,133,255,0.15); color: #0085ff; }
  .section-title { font-size: 13px; font-weight: 600; color: #888; padding: 8px 16px 4px; }
  .history-item { display: flex; align-items: center; padding: 10px 16px; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .platform-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; color: #fff; }
  .platform-icon.ig { background: #e1306c; }
  .platform-icon.tw { background: #1d9bf0; }
  .platform-icon.fb { background: #1877f2; }
  .details { flex: 1; }
  .details .filename { font-size: 13px; font-weight: 500; }
  .details .meta { font-size: 11px; color: #888; }
  .time { font-size: 11px; color: #666; }
  .footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #1a1a3e; }
  .footer button { flex: 1; padding: 8px; border: 1px solid #333; background: transparent; color: #aaa; border-radius: 8px; font-size: 12px; cursor: pointer; }
  .ext-icon { position: fixed; top: 8px; right: 20px; background: #7c3aed; width: 28px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 12px; }
  .arrow { position: fixed; top: 40px; right: 24px; width: 2px; height: 30px; background: #7c3aed; }
  .arrow::after { content: ''; position: absolute; bottom: -6px; left: -4px; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid #7c3aed; }
</style></head><body>
  <div class="browser-bar">
    <div class="dots"><div class="dot r"></div><div class="dot y"></div><div class="dot g"></div></div>
    <div class="url">instagram.com/p/ABC123</div>
  </div>
  <div class="ext-icon">S</div>
  <div class="arrow"></div>
  <div class="popup">
    <div class="popup-header">
      <div class="left"><div class="icon">S</div><h1>SocialSnag</h1></div>
      <span class="version">v1.1.0</span>
    </div>
    <div class="platforms">
      <div class="badge ig"><span class="dot"></span>Instagram</div>
      <div class="badge tw"><span class="dot"></span>Twitter/X</div>
      <div class="badge fb"><span class="dot"></span>Facebook</div>
      <div class="badge bs"><span class="dot"></span>Bluesky</div>
    </div>
    <div class="section-title">Recent downloads</div>
    <div class="history-item"><div class="platform-icon ig">IG</div><div class="details"><div class="filename">post_CxK7mBr_1</div><div class="meta">instagram</div></div><span class="time">2m</span></div>
    <div class="history-item"><div class="platform-icon tw">X</div><div class="details"><div class="filename">tweet_1834567890</div><div class="meta">twitter</div></div><span class="time">15m</span></div>
    <div class="history-item"><div class="platform-icon fb">FB</div><div class="details"><div class="filename">photo_9876543210</div><div class="meta">facebook</div></div><span class="time">1h</span></div>
    <div class="history-item"><div class="platform-icon ig">IG</div><div class="details"><div class="filename">reel_DwR4nPq</div><div class="meta">instagram</div></div><span class="time">3h</span></div>
    <div class="history-item"><div class="platform-icon tw">X</div><div class="details"><div class="filename">tweet_1834512345</div><div class="meta">twitter</div></div><span class="time">1d</span></div>
    <div class="footer">
      <button>Settings</button>
      <button>Clear history</button>
    </div>
  </div>
</body></html>`;

const optionsPage = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: #0a0e1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e0e0e0; display: flex; justify-content: center; padding-top: 40px; }
  .container { max-width: 560px; width: 100%; padding: 0 20px; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .logo { width: 36px; height: 36px; background: #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .logo svg { width: 20px; height: 20px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0; }
  .subtitle { color: #888; font-size: 14px; margin: 0 0 24px; }
  .card { background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  h2 { font-size: 15px; font-weight: 600; margin: 0 0 16px; color: #f0f0f0; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 8px; }
  .toggle-row.disabled { opacity: 0.4; }
  .toggle-label { font-size: 14px; font-weight: 500; }
  .toggle-desc { font-size: 12px; color: #666; margin-top: 2px; }
  .switch { width: 44px; height: 24px; background: #334155; border-radius: 12px; position: relative; flex-shrink: 0; }
  .switch.on { background: #3b82f6; }
  .switch .knob { width: 20px; height: 20px; background: #fff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: left 0.15s; }
  .switch.on .knob { left: 22px; }
  .coming-soon { font-size: 11px; color: #555; margin-top: 2px; }
  .disclaimer { font-size: 12px; color: #555; line-height: 1.6; margin-top: 16px; }
  .disclaimer a { color: #3b82f6; text-decoration: none; }
</style></head><body>
  <div class="container">
    <div class="header">
      <div class="logo"><svg viewBox="0 0 32 32" fill="none"><path d="M10 22V14l6-4 6 4v8" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 10v12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M12 16l4-4 4 4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1>SocialSnag settings</h1>
    </div>
    <p class="subtitle">Configure which platforms are enabled and how downloads behave.</p>
    <div class="card">
      <h2>Platform support</h2>
      <div class="toggle-row"><span class="toggle-label">Instagram</span><div class="switch on"><div class="knob"></div></div></div>
      <div class="toggle-row"><span class="toggle-label">Twitter / X</span><div class="switch on"><div class="knob"></div></div></div>
      <div class="toggle-row"><span class="toggle-label">Facebook</span><div class="switch on"><div class="knob"></div></div></div>
      <div class="toggle-row"><span class="toggle-label">Bluesky</span><div class="switch on"><div class="knob"></div></div></div>
    </div>
    <div class="card">
      <h2>Advanced modes</h2>
      <div class="toggle-row">
        <div><span class="toggle-label">Deep scan (webRequest)</span><p class="toggle-desc">Uses additional browser APIs to detect media not visible in the page.</p></div>
        <div class="switch"><div class="knob"></div></div>
      </div>
      <div class="toggle-row disabled">
        <div><span class="toggle-label">LinkedIn &amp; TikTok</span><div class="coming-soon">Coming soon</div></div>
        <div class="switch"><div class="knob"></div></div>
      </div>
    </div>
    <div class="card">
      <h2>About and privacy</h2>
      <p class="disclaimer">SocialSnag downloads publicly accessible media. No data is collected or transmitted.<br><br>Users are responsible for complying with copyright laws and platform terms of service.<br><br><a href="#">GitHub</a> &middot; <a href="#">Privacy policy</a></p>
    </div>
  </div>
</body></html>`;

const folderPage = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: #1e1e2e; font-family: 'Segoe UI', Tahoma, sans-serif; color: #cdd6f4; }
  .titlebar { background: #181825; padding: 8px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #313244; font-size: 13px; }
  .titlebar .dots { display: flex; gap: 6px; }
  .titlebar .dot { width: 12px; height: 12px; border-radius: 50%; }
  .titlebar .dot.r { background: #ff5f57; }
  .titlebar .dot.y { background: #febc2e; }
  .titlebar .dot.g { background: #28c840; }
  .breadcrumb { background: #11111b; padding: 8px 16px; font-size: 13px; color: #6c7086; border-bottom: 1px solid #313244; }
  .breadcrumb span { color: #89b4fa; }
  .sidebar { position: fixed; left: 0; top: 68px; width: 200px; background: #181825; height: calc(100% - 68px); padding: 12px 0; border-right: 1px solid #313244; }
  .sidebar .item { padding: 8px 16px; font-size: 13px; color: #6c7086; display: flex; align-items: center; gap: 8px; }
  .sidebar .item.active { color: #cdd6f4; background: rgba(137,180,250,0.1); }
  .sidebar .item .icon { font-size: 16px; }
  .content { margin-left: 200px; padding: 16px; }
  .folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
  .folder, .file { text-align: center; padding: 16px 8px; border-radius: 8px; cursor: pointer; }
  .folder:hover, .file:hover { background: rgba(137,180,250,0.05); }
  .folder .icon { font-size: 48px; color: #89b4fa; }
  .folder .name, .file .name { font-size: 12px; margin-top: 8px; word-break: break-all; }
  .file .icon { font-size: 40px; }
  .file .icon.img { color: #a6e3a1; }
  .file .icon.vid { color: #f38ba8; }
  .section-label { font-size: 11px; font-weight: 600; color: #585b70; text-transform: uppercase; letter-spacing: 1px; padding: 8px 0 12px; margin-top: 8px; }
</style></head><body>
  <div class="titlebar">
    <div class="dots"><div class="dot r"></div><div class="dot y"></div><div class="dot g"></div></div>
    Downloads / SocialSnag
  </div>
  <div class="breadcrumb">Downloads &gt; <span>SocialSnag</span></div>
  <div class="sidebar">
    <div class="item"><span class="icon">&#128193;</span> Downloads</div>
    <div class="item active"><span class="icon">&#128193;</span> SocialSnag</div>
    <div class="item" style="padding-left: 36px;"><span class="icon">&#128193;</span> instagram</div>
    <div class="item" style="padding-left: 36px;"><span class="icon">&#128193;</span> twitter</div>
    <div class="item" style="padding-left: 36px;"><span class="icon">&#128193;</span> facebook</div>
    <div class="item" style="padding-left: 36px;"><span class="icon">&#128193;</span> bluesky</div>
  </div>
  <div class="content">
    <div class="section-label">instagram/</div>
    <div class="folder-grid">
      <div class="file"><div class="icon img">&#128444;</div><div class="name">post_CxK7mBr_1.jpg</div></div>
      <div class="file"><div class="icon img">&#128444;</div><div class="name">post_CxK7mBr_2.jpg</div></div>
      <div class="file"><div class="icon vid">&#127916;</div><div class="name">reel_DwR4nPq.mp4</div></div>
      <div class="file"><div class="icon img">&#128444;</div><div class="name">post_BnL9sYp.jpg</div></div>
    </div>
    <div class="section-label">twitter/</div>
    <div class="folder-grid">
      <div class="file"><div class="icon img">&#128444;</div><div class="name">tweet_183456789.jpg</div></div>
      <div class="file"><div class="icon img">&#128444;</div><div class="name">tweet_183451234.jpg</div></div>
      <div class="file"><div class="icon vid">&#127916;</div><div class="name">tweet_183457890.mp4</div></div>
    </div>
    <div class="section-label">facebook/</div>
    <div class="folder-grid">
      <div class="file"><div class="icon img">&#128444;</div><div class="name">photo_9876543210.jpg</div></div>
      <div class="file"><div class="icon img">&#128444;</div><div class="name">photo_9876543211.jpg</div></div>
    </div>
    <div class="section-label">bluesky/</div>
    <div class="folder-grid">
      <div class="file"><div class="icon img">&#128444;</div><div class="name">bsky_post_3kx92.jpg</div></div>
    </div>
  </div>
</body></html>`;

const pages = [
  { name: '1-instagram-context-menu', html: instagramPage },
  { name: '2-twitter-context-menu', html: twitterPage },
  { name: '3-popup-download-history', html: popupPage },
  { name: '4-options-settings', html: optionsPage },
  { name: '5-folder-structure', html: folderPage },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  for (const page of pages) {
    const tab = await context.newPage();
    const tmpPath = join(tmpdir(), `socialsnag-screenshot-${page.name}.html`);
    writeFileSync(tmpPath, page.html);
    await tab.goto(pathToFileURL(tmpPath).href);
    await tab.waitForTimeout(500);

    const outPath = join(SCREENSHOT_DIR, `${page.name}.png`);
    await tab.screenshot({ path: outPath, fullPage: false });
    console.log(`Saved: ${outPath}`);
    await tab.close();
    unlinkSync(tmpPath);
  }

  await browser.close();
  console.log('All screenshots generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
