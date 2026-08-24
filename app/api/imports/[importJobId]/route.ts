import { requirePermission } from "@/lib/server/auth/authorize";
import {
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "import_job.read_own");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { importJobId } = await context.params;
    const job = await requiredOwnedImportJob(parseImportJobId(importJobId), auth.user);

    return json({
      ok: true,
      importJob: {
        id: job.id,
        workId: job.work_id,
        releaseId: job.release_id,
        archiveVersionId: job.archive_version_id,
        status: job.status,
        sourceName: job.source_name,
        sourceSizeBytes: job.source_size_bytes,
        fileCount: job.file_count,
        excludedFileCount: job.excluded_file_count,
        excludedSizeBytes: job.excluded_size_bytes,
        filePolicyVersion: job.file_policy_version,
        missingBlobCount: job.missing_blob_count,
        missingCorePackCount: job.missing_core_pack_count,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
      },
    });
  } catch (error) {
    return jsonError("Import job lookup failed", error);
  }
}
