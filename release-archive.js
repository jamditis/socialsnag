import { randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { unzipSync, zipSync } from 'fflate';

function collectFiles(rootDir, currentDir, files) {
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(rootDir, fullPath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`release archive cannot include non-file entry: ${fullPath}`);
    }

    const archivePath = relative(rootDir, fullPath).split(sep).join('/');
    files.set(archivePath, readFileSync(fullPath));
  }
}

export function collectReleaseFiles(rootDir) {
  const files = new Map();
  collectFiles(rootDir, rootDir, files);
  return files;
}

export function createReleaseArchive(files) {
  return Buffer.from(zipSync(Object.fromEntries(files), { level: 9 }));
}

export function readReleaseArchive(archiveBytes) {
  return new Map(
    Object.entries(unzipSync(archiveBytes)).map(([name, contents]) => [
      name,
      Buffer.from(contents),
    ]),
  );
}

export function verifyReleaseArchive(archiveBytes, expectedFiles) {
  if (!expectedFiles.has('manifest.json')) {
    throw new Error('release archive source has no root manifest.json');
  }

  const actualFiles = readReleaseArchive(archiveBytes);
  const expectedNames = [...expectedFiles.keys()].sort();
  const actualNames = [...actualFiles.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `release archive entries do not match dist (expected ${expectedNames.join(', ')}, got ${actualNames.join(', ')})`,
    );
  }

  for (const name of expectedNames) {
    if (!actualFiles.get(name).equals(expectedFiles.get(name))) {
      throw new Error(`release archive content does not match dist: ${name}`);
    }
  }
}

export function writeReleaseArchive(sourceDir, outputPath) {
  const expectedFiles = collectReleaseFiles(sourceDir);
  const archiveBytes = createReleaseArchive(expectedFiles);
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    writeFileSync(temporaryPath, archiveBytes, { flag: 'wx' });
    verifyReleaseArchive(readFileSync(temporaryPath), expectedFiles);
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
