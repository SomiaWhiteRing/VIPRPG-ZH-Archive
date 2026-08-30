import type {
  ArchiveCommitMetadata,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import { requirePermission } from "@/lib/server/auth/authorize";
import { commitArchiveImport } from "@/lib/server/db/archive-commit";
import {
  claimImportJobCommit,
  markImportJobCommitFailed,
  parseImportJobId,
  recordImportCommitSucceeded,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

type CommitRequest = {
  manifestSha256: string;
  manifestJson: string;
  metadata: ArchiveCommitMetadata;
  excludedFileTypes?: ExcludedFileTypeSummary[];
};

export async function POST(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const auth = await requirePermission(request, "import_job.commit_own");

  if ("response" in auth) {
    return auth.response;
  }

  const { importJobId } = await context.params;
  let id: number | null = null;
  let claimedCommit = false;

  try {
    id = parseImportJobId(importJobId);
    const job = await requiredOwnedImportJob(id, auth.user);
    const payload = await parseCommitRequest(request);
    await claimImportJobCommit(job.id);
    claimedCommit = true;

    const result = await commitArchiveImport({
      importJobId: id,
      user: auth.user,
      manifestSha256: payload.manifestSha256,
      manifestJson: payload.manifestJson,
      metadata: payload.metadata,
      excludedFileTypes: payload.excludedFileTypes ?? [],
    });
    // The archive commit is already durable; observability must not turn a
    // successful upload into a misleading 500 if its counter update fails.
    await recordImportCommitSucceeded({
      id,
      durationMs: Date.now() - startedAt,
      manifestSizeBytes: new TextEncoder().encode(payload.manifestJson)
        .byteLength,
    }).catch(() => undefined);

    return json({
      ok: true,
      result,
    });
  } catch (error) {
    if (id !== null && claimedCommit) {
      await markImportJobCommitFailed(
        id,
        error instanceof Error ? error.message : "Unknown error",
      ).catch(() => undefined);
    }
    return jsonError("Import commit failed", error);
  }
}

async function parseCommitRequest(request: Request): Promise<CommitRequest> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Invalid commit payload");
  }

  if (
    !isRecord(value) ||
    typeof value.manifestSha256 !== "string" ||
    typeof value.manifestJson !== "string" ||
    !isRecord(value.metadata)
  ) {
    throw new HttpError(400, "Invalid commit payload");
  }

  const excludedFileTypes = value.excludedFileTypes ?? [];
  if (
    !Array.isArray(excludedFileTypes) ||
    excludedFileTypes.some(
      (item) =>
        !isRecord(item) ||
        typeof item.fileType !== "string" ||
        !isNonNegativeInteger(item.fileCount) ||
        !isNonNegativeInteger(item.totalSizeBytes) ||
        typeof item.examplePath !== "string",
    )
  ) {
    throw new HttpError(400, "Invalid excluded file summary");
  }

  return {
    manifestSha256: value.manifestSha256,
    manifestJson: value.manifestJson,
    metadata: value.metadata as ArchiveCommitMetadata,
    excludedFileTypes: excludedFileTypes as ExcludedFileTypeSummary[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
