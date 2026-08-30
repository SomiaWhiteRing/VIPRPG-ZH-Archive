import { getD1 } from "@/lib/server/db/d1";
import { isArchiveEngineFamily } from "@/lib/labels";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";

export type ImportJobStatus =
  | "created"
  | "preflighted"
  | "uploading_source"
  | "awaiting_metadata"
  | "uploading_metadata"
  | "committing"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export const RECOVERABLE_IMPORT_JOB_STATUSES: readonly ImportJobStatus[] = [
  "awaiting_metadata",
  "uploading_metadata",
] as const;

export type ImportJobRow = {
  id: number;
  work_id: number | null;
  archive_version_id: number | null;
  uploader_id: number | null;
  status: ImportJobStatus;
  source_name: string | null;
  source_size_bytes: number | null;
  file_count: number;
  excluded_file_count: number;
  excluded_size_bytes: number;
  file_policy_version: string | null;
  missing_blob_count: number;
  missing_core_pack_count: number;
  missing_blob_size_bytes: number;
  missing_core_pack_size_bytes: number;
  uploaded_blob_count: number;
  uploaded_blob_size_bytes: number;
  uploaded_core_pack_count: number;
  uploaded_core_pack_size_bytes: number;
  manifest_put_count: number;
  manifest_size_bytes: number;
  r2_put_count: number;
  preflight_duration_ms: number | null;
  upload_duration_ms: number;
  commit_duration_ms: number | null;
  failed_stage: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function createImportJob(input: {
  uploader: ArchiveUser;
  targetWorkId: number | null;
  sourceName: string;
  sourceSizeBytes: number;
  fileCount: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  filePolicyVersion: string;
}): Promise<ImportJobRow> {
  if (input.targetWorkId !== null) {
    await assertArchiveWorkCanReceiveVersion(input.targetWorkId, input.uploader);
  }

  let result: D1Result;
  try {
    result = await getD1()
      .prepare(
        `INSERT INTO import_jobs (
          work_id, uploader_id, status, source_name, source_size_bytes,
          file_count, excluded_file_count, excluded_size_bytes,
          file_policy_version, created_at, updated_at
        ) VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        input.targetWorkId,
        input.uploader.id,
        input.sourceName,
        input.sourceSizeBytes,
        input.fileCount,
        input.excludedFileCount,
        input.excludedSizeBytes,
        input.filePolicyVersion,
      )
      .run();
  } catch (error) {
    if (
      input.targetWorkId !== null &&
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      throw new HttpError(409, "这款作品已有一个正在进行的新版本上传");
    }
    throw error;
  }

  const id = result.meta.last_row_id;
  if (!Number.isSafeInteger(id)) throw new Error("Import job was not created");
  return requiredImportJob(id);
}

async function assertArchiveWorkCanReceiveVersion(
  workId: number,
  user: ArchiveUser,
): Promise<void> {
  const canEditAny =
    user.status === "active" && user.permissionKeys.includes("work.update");
  const row = await getD1()
    .prepare(
      `SELECT
         w.engine_family,
         w.status,
         (SELECT COUNT(*) FROM archive_versions av WHERE av.work_id = w.id) AS archive_count,
         (SELECT COUNT(*) FROM work_external_links wel
          WHERE wel.work_id = w.id AND wel.link_type = 'download_page') AS download_count,
         EXISTS(
           SELECT 1 FROM work_uploaders wu
           WHERE wu.work_id = w.id AND wu.user_id = ?
         ) AS is_uploader
       FROM works w
       WHERE w.id = ?
       LIMIT 1`,
    )
    .bind(user.id, workId)
    .first<{
      engine_family: string;
      status: string;
      archive_count: number;
      download_count: number;
      is_uploader: number;
    }>();

  if (!row || row.status === "deleted") throw new HttpError(404, "作品不存在");
  if (!canEditAny && row.is_uploader !== 1) {
    throw new HttpError(403, "无权更新这款作品");
  }
  if (
    !isArchiveEngineFamily(row.engine_family) ||
    row.archive_count < 1 ||
    row.download_count !== 0
  ) {
    throw new HttpError(409, "只有本站归档作品可以上传新版本");
  }
}

export async function requiredImportJob(id: number): Promise<ImportJobRow> {
  const row = await findImportJob(id);
  if (!row) throw new Error("Import job not found");
  return row;
}

export async function findImportJob(id: number): Promise<ImportJobRow | null> {
  return getD1()
    .prepare(
      `SELECT
        id, work_id, archive_version_id, uploader_id, status, source_name,
        source_size_bytes, file_count, excluded_file_count, excluded_size_bytes,
        file_policy_version, missing_blob_count, missing_core_pack_count,
        missing_blob_size_bytes, missing_core_pack_size_bytes,
        uploaded_blob_count, uploaded_blob_size_bytes, uploaded_core_pack_count,
        uploaded_core_pack_size_bytes, manifest_put_count, manifest_size_bytes,
        r2_put_count, preflight_duration_ms, upload_duration_ms,
        commit_duration_ms, failed_stage, error_message, created_at, updated_at,
        completed_at
       FROM import_jobs
       WHERE id = ?`,
    )
    .bind(id)
    .first<ImportJobRow>();
}

export async function requiredOwnedImportJob(
  id: number,
  user: ArchiveUser,
): Promise<ImportJobRow> {
  const job = await findImportJob(id);
  if (!job || job.uploader_id !== user.id) {
    throw new HttpError(404, "Import job not found");
  }
  return job;
}

export async function requiredObjectUploadOwnedImportJob(
  id: number,
  user: ArchiveUser,
): Promise<ImportJobRow> {
  const job = await requiredOwnedImportJob(id, user);
  if (
    !["preflighted", "uploading_source", "uploading_metadata"].includes(
      job.status,
    )
  ) {
    throw new HttpError(409, "Import job does not accept object uploads");
  }
  return job;
}

export async function resumeOwnedImportJob(
  id: number,
  user: ArchiveUser,
): Promise<ImportJobRow> {
  const job = await requiredOwnedImportJob(id, user);
  if (RECOVERABLE_IMPORT_JOB_STATUSES.includes(job.status)) {
    await getD1()
      .prepare(
        `UPDATE import_jobs SET updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('awaiting_metadata', 'uploading_metadata')`,
      )
      .bind(id)
      .run();
    return requiredImportJob(id);
  }
  throw new HttpError(409, "上传草稿已经完成、失败、取消或过期");
}

export async function markImportJobPreflighted(input: {
  id: number;
  missingBlobCount: number;
  missingCorePackCount: number;
  missingBlobSizeBytes: number;
  missingCorePackSizeBytes: number;
  durationMs: number;
}): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'preflighted',
         missing_blob_count = ?, missing_core_pack_count = ?,
         missing_blob_size_bytes = ?, missing_core_pack_size_bytes = ?,
         preflight_duration_ms = ?, failed_stage = NULL, error_message = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('created', 'preflighted')`,
    )
    .bind(
      input.missingBlobCount,
      input.missingCorePackCount,
      input.missingBlobSizeBytes,
      input.missingCorePackSizeBytes,
      Math.max(0, input.durationMs),
      input.id,
    )
    .run();
  assertChanged(result, "Import job is no longer ready for preflight");
}

export async function recordImportObjectUpload(input: {
  id: number;
  objectKind: "blob" | "core_pack";
  sizeBytes: number;
  durationMs: number;
}): Promise<void> {
  const isBlob = input.objectKind === "blob";
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = CASE
           WHEN status IN ('preflighted', 'uploading_source') THEN 'uploading_source'
           ELSE 'uploading_metadata'
         END,
         uploaded_blob_count = uploaded_blob_count + ?,
         uploaded_blob_size_bytes = uploaded_blob_size_bytes + ?,
         uploaded_core_pack_count = uploaded_core_pack_count + ?,
         uploaded_core_pack_size_bytes = uploaded_core_pack_size_bytes + ?,
         r2_put_count = r2_put_count + 1,
         upload_duration_ms = upload_duration_ms + ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('preflighted', 'uploading_source', 'uploading_metadata')`,
    )
    .bind(
      isBlob ? 1 : 0,
      isBlob ? input.sizeBytes : 0,
      isBlob ? 0 : 1,
      isBlob ? 0 : input.sizeBytes,
      Math.max(0, input.durationMs),
      input.id,
    )
    .run();
  assertChanged(result, "Import job does not accept object uploads");
}

export async function markImportJobSourceReady(id: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'awaiting_metadata', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('preflighted', 'uploading_source', 'awaiting_metadata')`,
    )
    .bind(id)
    .run();
  assertChanged(result, "Import job source is no longer active");
}

export async function markImportJobMetadataReady(id: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'uploading_metadata', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('awaiting_metadata', 'uploading_metadata')`,
    )
    .bind(id)
    .run();
  assertChanged(result, "Import job metadata state can no longer be changed");
}

export async function claimImportJobCommit(id: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'committing', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'uploading_metadata'`,
    )
    .bind(id)
    .run();
  assertChanged(result, "Import job is not ready to commit");
}

export async function recordImportCommitSucceeded(input: {
  id: number;
  durationMs: number;
  manifestSizeBytes: number;
}): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE import_jobs
       SET manifest_put_count = CASE WHEN manifest_put_count = 0 THEN 1 ELSE manifest_put_count END,
         manifest_size_bytes = ?,
         r2_put_count = r2_put_count + CASE WHEN manifest_put_count = 0 THEN 1 ELSE 0 END,
         commit_duration_ms = ?, failed_stage = NULL, error_message = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'completed'`,
    )
    .bind(input.manifestSizeBytes, Math.max(0, input.durationMs), input.id)
    .run();
}

export async function markImportJobFailed(
  id: number,
  message: string,
  failedStage: string | null = null,
): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'failed', error_message = ?, failed_stage = ?,
         updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN (
            'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
            'uploading_metadata'
          )`,
    )
    .bind(message.slice(0, 1000), failedStage, id)
    .run();
  assertChanged(result, "Import job can no longer be marked as failed");
}

export async function markImportJobCommitFailed(
  id: number,
  message: string,
): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'failed', error_message = ?, failed_stage = 'commit',
         updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'committing'`,
    )
    .bind(message.slice(0, 1000), id)
    .run();
  assertChanged(result, "Import job commit is no longer active");
}

export async function markImportJobCanceled(id: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE import_jobs
       SET status = 'canceled', updated_at = CURRENT_TIMESTAMP,
         completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN (
           'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
           'uploading_metadata'
         )`,
    )
    .bind(id)
    .run();
  assertChanged(result, "Import job can no longer be canceled");
}

export function parseImportJobId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, "Invalid import job id");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, "Invalid import job id");
  return id;
}

function assertChanged(result: D1Result, message: string): void {
  if ((result.meta.changes ?? 0) === 0) throw new HttpError(409, message);
}
