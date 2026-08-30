import { requirePermission } from "@/lib/server/auth/authorize";
import { getD1 } from "@/lib/server/db/d1";
import {
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ importJobId: string }> },
) {
  const auth = await requirePermission(request, "import_job.create");
  if ("response" in auth) return auth.response;
  try {
    const { importJobId } = await context.params;
    const job = await requiredOwnedImportJob(parseImportJobId(importJobId), auth.user);
    const result =
      job.status === "completed" && job.work_id && job.archive_version_id
        ? await completedResult(job.work_id, job.archive_version_id)
        : null;
    return json({
      ok: true,
      importJob: {
        id: job.id,
        workId: job.work_id,
        archiveVersionId: job.archive_version_id,
        status: job.status,
        sourceName: job.source_name,
        sourceSizeBytes: job.source_size_bytes,
        fileCount: job.file_count,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message,
        result,
      },
    });
  } catch (error) {
    return jsonError("上传任务读取失败", error);
  }
}

async function completedResult(workId: number, archiveVersionId: number) {
  const row = await getD1()
    .prepare(
      `SELECT
         av.manifest_sha256,
         av.total_files,
         av.core_pack_count,
         (SELECT COUNT(*) FROM archive_version_blob_refs ref
          WHERE ref.archive_version_id=av.id) AS unique_blob_count
       FROM archive_versions av
       WHERE av.id=? AND av.work_id=?
       LIMIT 1`,
    )
    .bind(archiveVersionId, workId)
    .first<{
      manifest_sha256: string;
      total_files: number;
      core_pack_count: number;
      unique_blob_count: number;
    }>();
  return row
    ? {
        workId,
        archiveVersionId,
        manifestSha256: row.manifest_sha256,
        fileCount: row.total_files,
        uniqueBlobCount: row.unique_blob_count,
        corePackCount: row.core_pack_count,
      }
    : null;
}
