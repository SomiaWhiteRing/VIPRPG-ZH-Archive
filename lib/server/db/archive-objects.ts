import { getD1 } from "@/lib/server/db/d1";
import { chunkArray } from "@/lib/server/db/chunks";

export type ExistingObjectSet = {
  blobs: Set<string>;
  corePacks: Set<string>;
};

export async function findExistingObjects(input: {
  blobSha256: string[];
  corePackSha256: string[];
}): Promise<ExistingObjectSet> {
  const blobs = await findExistingSha256("blobs", input.blobSha256);
  const corePacks = await findExistingSha256("core_packs", input.corePackSha256);

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
  r2Key: string;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO blobs (
        sha256,
        size_bytes,
        content_type_hint,
        observed_ext,
        r2_key,
        verified_at,
        status
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
      ON CONFLICT(sha256) DO UPDATE SET
        size_bytes = excluded.size_bytes,
        content_type_hint = excluded.content_type_hint,
        observed_ext = excluded.observed_ext,
        r2_key = excluded.r2_key,
        verified_at = CURRENT_TIMESTAMP,
        status = 'active'`,
    )
    .bind(
      input.sha256,
      input.sizeBytes,
      input.contentTypeHint,
      input.observedExt,
      input.r2Key,
    )
    .run();
}

export async function insertCorePackRecord(input: {
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
  r2Key: string;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO core_packs (
        sha256,
        size_bytes,
        uncompressed_size_bytes,
        file_count,
        r2_key,
        verified_at,
        status
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
      ON CONFLICT(sha256) DO UPDATE SET
        size_bytes = excluded.size_bytes,
        uncompressed_size_bytes = excluded.uncompressed_size_bytes,
        file_count = excluded.file_count,
        r2_key = excluded.r2_key,
        verified_at = CURRENT_TIMESTAMP,
        status = 'active'`,
    )
    .bind(
      input.sha256,
      input.sizeBytes,
      input.uncompressedSizeBytes,
      input.fileCount,
      input.r2Key,
    )
    .run();
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
