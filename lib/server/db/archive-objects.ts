import { getD1 } from "@/lib/server/db/d1";
import { chunkArray } from "@/lib/server/db/chunks";
import { recordImportObjectUploadStatement } from "@/lib/server/db/import-jobs";
import { HttpError } from "@/lib/server/http/json";

export type ExistingObjectSet = {
  blobs: Set<string>;
  corePacks: Set<string>;
};

type BlobRecordInput = {
  sha256: string;
  sizeBytes: number;
  contentTypeHint: string | null;
  observedExt: string | null;
};

type CorePackRecordInput = {
  sha256: string;
  sizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
};

export async function prepareObjectUpload(input: {
  kind: "blob" | "core_pack";
  sha256: string;
  importJobId: number;
  userId: number;
}): Promise<"exists" | "missing"> {
  const table = input.kind === "blob" ? "blobs" : "core_packs";
  const row = await getD1()
    .prepare(
      `SELECT j.status AS import_status,o.status AS object_status
       FROM import_jobs j
       LEFT JOIN ${table} o ON o.sha256=?
       WHERE j.id=? AND j.uploader_id=?
       LIMIT 1`,
    )
    .bind(input.sha256, input.importJobId, input.userId)
    .first<{ import_status: string; object_status: string | null }>();
  if (!row) throw new HttpError(404, "Import job not found");
  if (!["preflighted", "uploading_source", "uploading_metadata"].includes(row.import_status)) {
    throw new HttpError(409, "Import job does not accept object uploads");
  }
  if (row.object_status === "purging") {
    throwObjectPurging(input.kind);
  }
  return row.object_status === "active" ? "exists" : "missing";
}

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
    throwObjectPurging(input.kind);
  }
}

export async function findExistingObjects(input: {
  blobSha256: string[];
  corePackSha256: string[];
}): Promise<ExistingObjectSet> {
  const database = getD1();
  const queries: Array<{
    kind: "blob" | "core_pack";
    statement: D1PreparedStatement;
  }> = [];
  for (const [kind, table, hashes] of [
    ["blob", "blobs", input.blobSha256],
    ["core_pack", "core_packs", input.corePackSha256],
  ] as const) {
    for (const chunk of chunkArray([...new Set(hashes)], 100)) {
      queries.push({
        kind,
        statement: database
          .prepare(
            `SELECT sha256 FROM ${table}
             WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(...chunk),
      });
    }
  }
  const existing: ExistingObjectSet = { blobs: new Set(), corePacks: new Set() };
  if (!queries.length) return existing;
  const results = await database.batch(queries.map((query) => query.statement));
  results.forEach((result, index) => {
    const target = queries[index].kind === "blob" ? existing.blobs : existing.corePacks;
    for (const row of (result.results ?? []) as Array<{ sha256: string }>) target.add(row.sha256);
  });
  return existing;
}

export async function insertBlobRecord(input: BlobRecordInput): Promise<void> {
  const database = getD1();
  assertObjectRecordChanged(
    await blobRecordStatement(database, input).run(),
    "blob",
  );
}

export async function insertCorePackRecord(input: CorePackRecordInput): Promise<void> {
  const database = getD1();
  assertObjectRecordChanged(
    await corePackRecordStatement(database, input).run(),
    "core_pack",
  );
}

export async function insertBlobRecords(inputs: BlobRecordInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const database = getD1();
  const results = await database.batch(inputs.map((input) => blobRecordStatement(database, input)));
  for (const result of results) assertObjectRecordChanged(result, "blob");
}

export async function recordUploadedBlob(input: BlobRecordInput & {
  importJobId: number;
  durationMs: number;
}): Promise<void> {
  const database = getD1();
  const results = await database.batch([
    blobRecordStatement(database, input),
    recordImportObjectUploadStatement(database, {
      id: input.importJobId,
      objectKind: "blob",
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
    }, { requirePreviousChange: true }),
  ]);
  assertObjectRecordChanged(results[0], "blob");
  assertImportJobUploadChanged(results[1]);
}

export async function recordUploadedCorePack(input: CorePackRecordInput & {
  importJobId: number;
  durationMs: number;
}): Promise<void> {
  const database = getD1();
  const results = await database.batch([
    corePackRecordStatement(database, input),
    recordImportObjectUploadStatement(database, {
      id: input.importJobId,
      objectKind: "core_pack",
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
    }, { requirePreviousChange: true }),
  ]);
  assertObjectRecordChanged(results[0], "core_pack");
  assertImportJobUploadChanged(results[1]);
}

export async function findObjectStatuses(
  kind: "blob" | "core_pack",
  hashes: string[],
): Promise<Map<string, string>> {
  const uniqueHashes = [...new Set(hashes)];
  if (uniqueHashes.length === 0) return new Map();
  const table = kind === "blob" ? "blobs" : "core_packs";
  const database = getD1();
  const statements = chunkArray(uniqueHashes, 100).map((chunk) =>
    database
      .prepare(`SELECT sha256,status FROM ${table} WHERE sha256 IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
  );
  const results = await database.batch<{ sha256: string; status: string }>(statements);
  const statuses = new Map<string, string>();
  for (const result of results) {
    for (const row of result.results ?? []) statuses.set(row.sha256, row.status);
  }
  return statuses;
}

function blobRecordStatement(database: D1Database, input: BlobRecordInput): D1PreparedStatement {
  return database
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
    .bind(input.sha256, input.sizeBytes, input.contentTypeHint, input.observedExt);
}

function corePackRecordStatement(database: D1Database, input: CorePackRecordInput): D1PreparedStatement {
  return database
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
    .bind(input.sha256, input.sizeBytes, input.uncompressedSizeBytes, input.fileCount);
}

function assertObjectRecordChanged(result: D1Result, kind: "blob" | "core_pack"): void {
  if ((result.meta.changes ?? 0) === 0) throwObjectPurging(kind);
}

function assertImportJobUploadChanged(result: D1Result): void {
  if ((result.meta.changes ?? 0) === 0) {
    throw new HttpError(409, "Import job does not accept object uploads");
  }
}

function throwObjectPurging(kind: "blob" | "core_pack"): never {
  throw new HttpError(
    409,
    `${kind === "blob" ? "Blob" : "Core pack"} is being garbage-collected; retry the upload`,
  );
}
