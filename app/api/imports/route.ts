import { FILE_POLICY_VERSION } from "@/lib/archive/file-policy";
import { requireUploader } from "@/lib/server/auth/guards";
import { createImportJob } from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type CreateImportRequest = {
  sourceName?: string;
  sourceSizeBytes?: number;
  fileCount?: number;
  excludedFileCount?: number;
  excludedSizeBytes?: number;
  filePolicyVersion?: string;
};

export async function POST(request: Request) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const payload = (await request.json()) as CreateImportRequest;
    const filePolicyVersion = String(payload.filePolicyVersion ?? "");

    if (filePolicyVersion !== FILE_POLICY_VERSION) {
      return json(
        {
          ok: false,
          error: "Unsupported file policy version",
          expected: FILE_POLICY_VERSION,
          actual: filePolicyVersion,
        },
        { status: 400 },
      );
    }

    const job = await createImportJob({
      uploaderId: auth.user.id,
      sourceName: readString(payload.sourceName, "sourceName"),
      sourceSizeBytes: readNonNegativeInteger(
        payload.sourceSizeBytes,
        "sourceSizeBytes",
      ),
      fileCount: readNonNegativeInteger(payload.fileCount, "fileCount"),
      excludedFileCount: readNonNegativeInteger(
        payload.excludedFileCount,
        "excludedFileCount",
      ),
      excludedSizeBytes: readNonNegativeInteger(
        payload.excludedSizeBytes,
        "excludedSizeBytes",
      ),
      filePolicyVersion,
    });

    return json(
      {
        ok: true,
        importJob: mapImportJob(job),
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Import job creation failed", error);
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${name}`);
  }

  return value.trim();
}

function readNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid ${name}`);
  }

  return Number(value);
}

function mapImportJob(job: Awaited<ReturnType<typeof createImportJob>>) {
  return {
    id: job.id,
    status: job.status,
    sourceName: job.source_name,
    sourceSizeBytes: job.source_size_bytes,
    fileCount: job.file_count,
    excludedFileCount: job.excluded_file_count,
    excludedSizeBytes: job.excluded_size_bytes,
    filePolicyVersion: job.file_policy_version,
    missingBlobCount: job.missing_blob_count,
    missingCorePackCount: job.missing_core_pack_count,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  };
}
