import { getD1 } from "@/lib/server/db/d1";
import { chunkArray } from "@/lib/server/db/chunks";
import { HttpError } from "@/lib/server/http/json";

export type ExistingObjectSet = {
  blobs: Set<string>;
  corePacks: Set<string>;
};

export async function assertObjectUploadAllowed(input: {
  kind: "blob" | "core_pack";
  sha256: string;
}): Promise<void> {
  const table = input.kind === "blob" ? "blobs" : "core_packs";
  const row = await getD1()
    .prepare(`SELECT status FROM ${table} WHERE sha256 = ? LIMIT 1`)
    .bind(input.sha256)
    .first<{ status: string }>();

  if (row?.status === "purging") {
    throw new HttpError(
      409,
      `${input.kind === "blob" ? "Blob" : "Core pack"} is being garbage-collected; retry the upload`,
    );
  }
}

export async function findExistingObjects(input: {
  blobSha256: string[];
  corePackSha256: string[];
}): Promise<ExistingObjectSet> {
  const blobs = await findExistingSha256("blobs", input.blobSha256);
  const corePacks = await findExistingSha256(
    "core_packs",
    input.corePackSha256,
  );

  return {
    blobs,
    corePacks,
  };
}

export async function insertBlobRecord(input: {
  sha256: string;
  sizeBytes: number;
  contentTypeHint: string | null;
  observedExt: string | null;
}): Promise<void> {
  const result = await getD1()
    .prepare(
      `INSERT INTO blobs (
        sha256,
        size_bytes,
        content_type_hint,
        observed_ext,
        verified_at,
        status
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
      ON CONFLICT(sha256) DO UPDATE SET
        size_bytes = excluded.size_bytes,
        content_type_hint = excluded.content_type_hint,
        observed_ext = excluded.observed_ext,
        verified_at = CURRENT_TIMESTAMP,
        created_at = CASE WHEN blobs.status = 'purged' THEN CURRENT_TIMESTAMP ELSE blobs.created_at END,
        status = 'active'
      WHERE blobs.status IN ('active', 'purged')`,
    )
    .bind(
      input.sha256,
      input.sizeBytes,
      input.contentTypeHint,
      input.observedExt,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HttpError(
      409,
      "Blob is being garbage-collected; retry the upload",
    );
  }
}

export async function insertCorePackRecord(input: {
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
}): Promise<void> {
  const result = await getD1()
    .prepare(
      `INSERT INTO core_packs (
        sha256,
        size_bytes,
        uncompressed_size_bytes,
        file_count,
        verified_at,
        status
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
      ON CONFLICT(sha256) DO UPDATE SET
        size_bytes = excluded.size_bytes,
        uncompressed_size_bytes = excluded.uncompressed_size_bytes,
        file_count = excluded.file_count,
        verified_at = CURRENT_TIMESTAMP,
        created_at = CASE WHEN core_packs.status = 'purged' THEN CURRENT_TIMESTAMP ELSE core_packs.created_at END,
        status = 'active'
      WHERE core_packs.status IN ('active', 'purged')`,
    )
    .bind(
      input.sha256,
      input.sizeBytes,
      input.uncompressedSizeBytes,
      input.fileCount,
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HttpError(
      409,
      "Core pack is being garbage-collected; retry the upload",
    );
  }
}

async function findExistingSha256(
  tableName: "blobs" | "core_packs",
  hashes: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  const uniqueHashes = [...new Set(hashes)];

  for (const chunk of chunkArray(uniqueHashes, 100)) {
    if (chunk.length === 0) {
      continue;
    }

    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await getD1()
      .prepare(
        `SELECT sha256
        FROM ${tableName}
        WHERE status = 'active'
          AND sha256 IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ sha256: string }>();

    for (const row of rows.results ?? []) {
      existing.add(row.sha256);
    }
  }

  return existing;
}
