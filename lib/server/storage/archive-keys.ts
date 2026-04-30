export function blobKey(sha256: string): string {
  assertSha256(sha256);
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export function corePackKey(sha256: string): string {
  assertSha256(sha256);
  return `core-packs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.zip`;
}

export function manifestKey(manifestSha256: string): string {
  assertSha256(manifestSha256);
  return `manifests/sha256/${manifestSha256.slice(0, 2)}/${manifestSha256.slice(2, 4)}/${manifestSha256}.json`;
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid SHA-256 value");
  }
}
