import { normalizeSha256 } from "@/lib/sha256";
import { findExistingObjects } from "@/app/.server/db/archive-objects";
import type { AppRuntime } from "@/app/.server/runtime";
import { UiHttpError } from "@/lib/i18n/feedback";

export type ImportObjectReferences = {
  blobs: string[];
  corePacks: string[];
};

export function parseImportObjectReferences(
  value: unknown,
): ImportObjectReferences {
  if (
    !isRecord(value) ||
    !Array.isArray(value.blobs) ||
    !Array.isArray(value.corePacks)
  ) {
    throw new UiHttpError(400, "upload.error.draftList");
  }
  return {
    blobs: normalizeHashItems(value.blobs),
    corePacks: normalizeHashItems(value.corePacks),
  };
}

export async function findMissingImportObjectReferences(
  runtime: AppRuntime,
  references: ImportObjectReferences,
): Promise<ImportObjectReferences> {
  const existing = await findExistingObjects(runtime, {
    blobSha256: references.blobs,
    corePackSha256: references.corePacks,
  });
  return {
    blobs: references.blobs.filter((hash) => !existing.blobs.has(hash)),
    corePacks: references.corePacks.filter(
      (hash) => !existing.corePacks.has(hash),
    ),
  };
}

function normalizeHashItems(
  values: unknown[],
): string[] {
  const hashes = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.sha256 !== "string") {
      throw new UiHttpError(400, "upload.error.draftHash");
    }
    try {
      hashes.add(normalizeSha256(value.sha256));
    } catch {
      throw new UiHttpError(400, "upload.error.draftHash");
    }
  }
  return [...hashes];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
