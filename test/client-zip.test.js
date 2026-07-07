import { describe, it, expect } from 'vitest';
// No vi.mock here on purpose: this exercises the REAL client-zip library so a
// breaking major-version bump is caught. Every other zip test mocks it out to
// isolate the fetch/response logic, which means nothing else proves the archive
// actually builds. downloadZip runs in Node 18+ (Blob + arrayBuffer available).
import { downloadZip } from 'client-zip';

describe('client-zip integration (real library, unmocked)', () => {
  it('builds a real zip whose bytes start with the PK local-file signature', async () => {
    const blob = await downloadZip([
      { name: 'a.txt', input: 'hello' },
      { name: 'b.txt', input: 'world' },
    ]).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Every zip entry begins with the local file header magic "PK\x03\x04".
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    expect(blob.size).toBeGreaterThan(0);
  });
});
