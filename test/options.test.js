import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TEMPLATE_TOKENS } from '../src/platforms/common.js';

const html = readFileSync(new URL('../src/options.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/options.js', import.meta.url), 'utf8');

describe('options page filename template', () => {
  it('documents every template token on the options page', () => {
    // The field descriptions are the only place a user learns the vocabulary, so
    // a token added to the shared list has to be documented here too. This is the
    // check that keeps the two from drifting.
    for (const token of TEMPLATE_TOKENS) {
      expect(html).toContain(`{${token}}`);
    }
  });

  it('adds the filename field with its inline error and preview', () => {
    expect(html).toContain('id="filename-template"');
    expect(html).toContain('id="filename-template-error"');
    expect(html).toContain('id="filename-preview"');
    // The folder field gains an error line too, since it is now validated.
    expect(html).toContain('id="download-path-error"');
  });

  it('reaches the shared validator by import, not a third inline copy', () => {
    // #47 removed a duplicated validator; the options page must call the shared
    // one rather than reintroduce that drift. esbuild bundles the import into the
    // classic script the page loads (background.js does the same), so options.html
    // stays a plain <script> like every other page here rather than a module.
    expect(js).toMatch(
      /import\s*\{[^}]*templateFieldError[^}]*\}\s*from\s*'\.\/platforms\/common\.js'/,
    );
    expect(html).toContain('<script src="options.js"></script>');
  });
});

describe('options page download quality', () => {
  it('offers the supported Instagram widths and persists the choice', () => {
    expect(html).toContain('id="download-quality"');
    expect(html).toContain('<option value="largest">Largest available</option>');
    expect(html).toContain('<option value="1080">Up to 1080 px wide</option>');
    expect(html).toContain('<option value="720">Up to 720 px wide</option>');
    expect(js).toContain("downloadQuality: 'largest'");
    expect(js).toContain("settings.downloadQuality = document.getElementById('download-quality').value");
    expect(js).toContain("document.getElementById('download-quality').value = items.downloadQuality");
    expect(js).toContain("document.getElementById('download-quality').addEventListener('change', saveSettings)");
  });
});
