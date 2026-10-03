export function blobKey(sha256: string): string {
  const normalized = canonicalHash(sha256);
  return `blobs/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}`;
}

export function corePackKey(sha256: string): string {
  const normalized = canonicalHash(sha256);
  return `core-packs/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}.zip`;
}

export function manifestKey(sha256: string): string {
  const normalized = canonicalHash(sha256);
  return `manifests/sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}.json`;
}

function canonicalHash(value: string): string {
  if (!/^[a-f0-9]{64}$/iu.test(value)) throw new Error("Invalid SHA-256 value");
  return value.toLowerCase();
}
