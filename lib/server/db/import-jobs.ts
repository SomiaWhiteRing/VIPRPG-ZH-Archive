import { canManageUsersRole } from "@/lib/server/auth/roles";
import type { ArchiveUser } from "@/lib/server/db/users";
import { getD1 } from "@/lib/server/db/d1";

export type ImportJobRow = {
  id: number;
  work_id: number | null;
  release_id: number | null;
  archive_version_id: number | null;
  uploader_id: number | null;
  status: string;
  source_name: string | null;
  source_size_bytes: number | null;
  file_count: number;
  excluded_file_count: number;
  excluded_size_bytes: number;
  file_policy_version: string | null;
  missing_blob_count: number;
  missing_core_pack_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function createImportJob(input: {
  uploaderId: number;
  sourceName: string;
  sourceSizeBytes: number;
  fileCount: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  filePolicyVersion: string;
}): Promise<ImportJobRow> {
  const result = await getD1()
    .prepare(
      `INSERT INTO import_jobs (
        uploader_id,
        status,
        source_name,
        source_size_bytes,
        file_count,
        excluded_file_count,
        excluded_size_bytes,
        file_policy_version,
        created_at,
        updated_at
      ) VALUES (?, 'created', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      input.uploaderId,
      input.sourceName,
      input.sourceSizeBytes,
      input.fileCount,
      input.excludedFileCount,
      input.excludedSizeBytes,
      input.filePolicyVersion,
    )
    .run();

  const id = result.meta.last_row_id;

  if (!Number.isSafeInteger(id)) {
    throw new Error("Import job was not created");
  }

  return requiredImportJob(id);
}

export async function requiredImportJob(id: number): Promise<ImportJobRow> {
  const row = await findImportJob(id);

  if (!row) {
    throw new Error("Import job not found");
  }

  return row;
}

export async function findImportJob(id: number): Promise<ImportJobRow | null> {
  return getD1()
    .prepare(
      `SELECT
        id,
        work_id,
        release_id,
        archive_version_id,
        uploader_id,
        status,
        source_name,
        source_size_bytes,
        file_count,
        excluded_file_count,
        excluded_size_bytes,
        file_policy_version,
        missing_blob_count,
        missing_core_pack_count,
        error_message,
        created_at,
        updated_at,
        completed_at
      FROM import_jobs
      WHERE id = ?`,
    )
    .bind(id)
    .first<ImportJobRow>();
}

export function assertImportJobAccess(job: ImportJobRow, user: ArchiveUser): void {
  if (job.uploader_id === user.id || canManageUsersRole(user.role)) {
    return;
  }

  throw new Error("Import job access denied");
}

export async function markImportJobPreflighted(input: {
  id: number;
  missingBlobCount: number;
  missingCorePackCount: number;
}): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE import_jobs
      SET status = 'preflighted',
        missing_blob_count = ?,
        missing_core_pack_count = ?,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(input.missingBlobCount, input.missingCorePackCount, input.id)
    .run();
}

export async function markImportJobFailed(id: number, message: string): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE import_jobs
      SET status = 'failed',
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(message.slice(0, 1000), id)
    .run();
}

export async function markImportJobCanceled(id: number): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE import_jobs
      SET status = 'canceled',
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status NOT IN ('completed', 'canceled')`,
    )
    .bind(id)
    .run();
}

export function parseImportJobId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid import job id");
  }

  return id;
}
