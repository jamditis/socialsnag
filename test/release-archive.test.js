import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readReleaseArchive, writeReleaseArchive } from '../release-archive.js';

const temporaryDirectories = [];

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'socialsnag-release-'));
  temporaryDirectories.push(root);
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'icons'), { recursive: true });
  writeFileSync(join(dist, 'manifest.json'), '{"manifest_version":3}\n');
  writeFileSync(join(dist, 'background.js'), 'console.log("ready");\n');
  writeFileSync(join(dist, 'icons', 'icon.png'), Buffer.from([0, 1, 2, 255]));
  return { root, dist, output: join(root, 'socialsnag-1.3.0.zip') };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release archive', () => {
  it('builds and inspects the exact dist tree without system archive tools', () => {
    const { dist, output } = makeFixture();
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      writeReleaseArchive(dist, output);
    } finally {
      process.env.PATH = originalPath;
    }

    const files = readReleaseArchive(readFileSync(output));
    expect([...files.keys()].sort()).toEqual([
      'background.js',
      'icons/icon.png',
      'manifest.json',
    ]);
    expect(files.get('manifest.json').toString()).toBe('{"manifest_version":3}\n');
    expect(files.get('icons/icon.png')).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('replaces a stale archive instead of retaining removed entries', () => {
    const { dist, output } = makeFixture();
    writeFileSync(join(dist, 'stale.js'), 'stale\n');
    writeReleaseArchive(dist, output);

    rmSync(join(dist, 'stale.js'));
    writeFileSync(join(dist, 'current.js'), 'current\n');
    writeReleaseArchive(dist, output);

    const files = readReleaseArchive(readFileSync(output));
    expect(files.has('stale.js')).toBe(false);
    expect(files.get('current.js').toString()).toBe('current\n');
  });

  it('preserves the prior archive and removes its temporary file when verification fails', () => {
    const { root, dist, output } = makeFixture();
    writeReleaseArchive(dist, output);
    const priorArchive = readFileSync(output);
    rmSync(join(dist, 'manifest.json'));

    expect(() => writeReleaseArchive(dist, output)).toThrow(
      'release archive source has no root manifest.json',
    );
    expect(readFileSync(output)).toEqual(priorArchive);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
