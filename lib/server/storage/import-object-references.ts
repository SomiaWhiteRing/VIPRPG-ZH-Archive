import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import { HttpError } from "@/lib/server/http/json";

export type ImportObjectReferences = {
  blobs: string[];
  corePacks: string[];
};

export function parseImportObjectReferences(
  value: unknown,
  messages: { invalidList: string; invalidHash: string },
): ImportObjectReferences {
  if (!isRecord(value) || !Array.isArray(value.blobs) || !Array.isArray(value.corePacks)) {
    throw new HttpError(400, messages.invalidList);
  }
  return {
    blobs: normalizeHashItems(value.blobs, messages.invalidHash),
    corePacks: normalizeHashItems(value.corePacks, messages.invalidHash),
  };
}

export async function findMissingImportObjectReferences(
  references: ImportObjectReferences,
): Promise<ImportObjectReferences> {
  const existing = await findExistingObjects({
    blobSha256: references.blobs,
    corePackSha256: references.corePacks,
  });
  return {
    blobs: references.blobs.filter((hash) => !existing.blobs.has(hash)),
    corePacks: references.corePacks.filter((hash) => !existing.corePacks.has(hash)),
  };
}

function normalizeHashItems(values: unknown[], invalidMessage: string): string[] {
  const hashes = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.sha256 !== "string") {
      throw new HttpError(400, invalidMessage);
    }
    try {
      hashes.add(normalizeSha256(value.sha256));
    } catch {
      throw new HttpError(400, invalidMessage);
    }
  }
  return [...hashes];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
