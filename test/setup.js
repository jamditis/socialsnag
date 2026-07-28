import { afterEach } from 'vitest';
import './chrome-mock.js';

// Session storage is a real cache in production and is meant to outlive a single
// download, but inside one test file it would outlive a single test case too: the
// resolve cache would answer the next case with the previous case's fixture, so a
// test that stubs a 429 would silently get a cached success instead. Clearing it
// between cases keeps each test's fetch stubs the only source of resolver data.
afterEach(() => {
  globalThis.chrome?.storage?.session?._reset?.();
});
