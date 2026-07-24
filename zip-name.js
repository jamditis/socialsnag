// Portable zip-name derivation, shared by build.js and publish-cws.js so the
// build step and the publish step always agree on the filename.
//
// The zip is named "<package-name>-<version>.zip". A scoped npm name such as
// "@org/ext" contains a slash, so the naive form "@org/ext-1.0.0.zip" is a
// nested path: `zip -r` would write it into a missing "@org/" directory (or
// fail) and publish-cws.js would then look for that same nested name. Flatten
// the name to a single path segment first.

// Strip a leading "@scope/" and collapse any remaining path separators, so a
// scoped or otherwise slashed package name becomes one flat filename segment.
export function packageZipSlug(name) {
  return String(name)
    .replace(/^@[^/]+\//, '')
    .replace(/[/\\]/g, '-');
}

// The default zip filename for a package: "<flat-slug>-<version>.zip".
export function zipFileName(name, version) {
  return `${packageZipSlug(name)}-${version}.zip`;
}
