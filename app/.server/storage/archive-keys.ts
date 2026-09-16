export function blobKey(sha256: string): string {
  assertSha256(sha256);
  const normalized = sha256.toLowerCase();
  return `blobs/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}`;
}

export function corePackKey(sha256: string): string {
  assertSha256(sha256);
  const normalized = sha256.toLowerCase();
  return `core-packs/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}.zip`;
}

export function manifestKey(manifestSha256: string): string {
  assertSha256(manifestSha256);
  const normalized = manifestSha256.toLowerCase();
  return `manifests/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}.json`;
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid SHA-256 value");
  }
}
