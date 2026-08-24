import type { ArchiveCommitMetadata, ExcludedFileTypeSummary } from "@/lib/archive/manifest";
import { requirePermission } from "@/lib/server/auth/authorize";
import { commitArchiveImport } from "@/lib/server/db/archive-commit";
import {
  markImportJobFailed,
  parseImportJobId,
  recordImportCommitSucceeded,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

type CommitRequest = {
  localTaskId?: string;
  manifestSha256?: string;
  manifestJson?: string;
  metadata?: ArchiveCommitMetadata;
  excludedFileTypes?: ExcludedFileTypeSummary[];
};

export async function POST(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const auth = await requirePermission(request, "import_job.commit_own");

  if ("response" in auth) {
    return auth.response;
  }

  const { importJobId } = await context.params;
  const id = parseImportJobId(importJobId);
  let authorizedForJob = false;

  try {
    await requiredOwnedImportJob(id, auth.user);
    authorizedForJob = true;

    const payload = (await request.json()) as CommitRequest;

    if (
      typeof payload.localTaskId !== "string" ||
      typeof payload.manifestSha256 !== "string" ||
      typeof payload.manifestJson !== "string" ||
      !payload.metadata
    ) {
      return json(
        {
          ok: false,
          error: "Invalid commit payload",
        },
        { status: 400 },
      );
    }

    const result = await commitArchiveImport({
      importJobId: id,
      user: auth.user,
      localTaskId: payload.localTaskId,
      manifestSha256: payload.manifestSha256,
      manifestJson: payload.manifestJson,
      metadata: payload.metadata,
      excludedFileTypes: payload.excludedFileTypes ?? [],
    });
    await recordImportCommitSucceeded({
      id,
      durationMs: Date.now() - startedAt,
      manifestSizeBytes: new TextEncoder().encode(payload.manifestJson).byteLength,
    });

    return json({
      ok: true,
      result,
    });
  } catch (error) {
    if (authorizedForJob) {
      await markImportJobFailed(
        id,
        error instanceof Error ? error.message : "Unknown error",
        "commit",
      );
    }
    return jsonError("Import commit failed", error);
  }
}
