import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';

const isZip = process.argv.includes('--zip');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/platforms', { recursive: true });

const entryPoints = [
  { in: 'src/background.js', out: 'background' },
  { in: 'src/platforms/instagram.js', out: 'platforms/instagram' },
  { in: 'src/platforms/twitter.js', out: 'platforms/twitter' },
  { in: 'src/platforms/facebook.js', out: 'platforms/facebook' },
  { in: 'src/popup.js', out: 'popup' },
  { in: 'src/options.js', out: 'options' },
];

await esbuild.build({
  entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  minify: isZip,
  target: ['chrome116'],
});

cpSync('icons', 'dist/icons', { recursive: true });
cpSync('src/fonts', 'dist/fonts', { recursive: true });
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/popup.css', 'dist/popup.css');
cpSync('src/options.html', 'dist/options.html');
cpSync('src/options.css', 'dist/options.css');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.content_scripts = manifest.content_scripts.map((cs) => ({
  ...cs,
  js: cs.js.filter((f) => f !== 'platforms/common.js'),
}));
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));

console.log('Build complete: dist/');

if (isZip) {
  const version = manifest.version;
  const zipName = `socialsnag-${version}.zip`;
  execFileSync('zip', ['-r', `../${zipName}`, '.'], { cwd: 'dist' });
  console.log(`Zip created: ${zipName}`);
}
