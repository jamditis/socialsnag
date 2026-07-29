import { afterEach } from 'vitest';
import './chrome-mock.js';
import { clearResolveCache } from '../src/platforms/resolve-cache.js';

// The resolve cache lives for the service worker's lifetime, which in production
// spans many downloads but inside one test file would span test cases too: a
// cached fixture would answer the next case, so a test that stubs a 429 would
// silently get the previous case's success. Clearing between cases keeps each
// test's fetch stubs the only source of resolver data.
afterEach(() => {
  clearResolveCache();
});
