import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { requireUploader } from "@/lib/server/auth/guards";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import {
  assertImportJobAccess,
  markImportJobFailed,
  markImportJobPreflighted,
  parseImportJobId,
  requiredImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    importJobId: string;
  }>;
};

type PreflightRequest = {
  blobs?: HashInput[];
  corePacks?: HashInput[];
};

type HashInput =
  | string
  | {
      sha256?: string;
      sizeBytes?: number;
    };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  const startedAt = Date.now();
  let parsedImportJobId: number | null = null;
  let authorizedForJob = false;

  try {
    const { importJobId } = await context.params;
    parsedImportJobId = parseImportJobId(importJobId);
    const job = await requiredImportJob(parsedImportJobId);
    assertImportJobAccess(job, auth.user);
    authorizedForJob = true;

    const payload = (await request.json()) as PreflightRequest;
    const blobObjects = normalizeHashInputs(payload.blobs ?? []);
    const corePackObjects = normalizeHashInputs(payload.corePacks ?? []);
    const blobSha256 = blobObjects.map((item) => item.sha256);
    const corePackSha256 = corePackObjects.map((item) => item.sha256);
    const existing = await findExistingObjects({
      blobSha256,
      corePackSha256,
    });
    const blobSummary = summarize(blobObjects, existing.blobs);
    const corePackSummary = summarize(corePackObjects, existing.corePacks);

    await markImportJobPreflighted({
      id: job.id,
      missingBlobCount: blobSummary.missingCount,
      missingCorePackCount: corePackSummary.missingCount,
      missingBlobSizeBytes: blobSummary.missingSizeBytes,
      missingCorePackSizeBytes: corePackSummary.missingSizeBytes,
      durationMs: Date.now() - startedAt,
    });

    return json({
      ok: true,
      importJobId: job.id,
      blobs: blobSummary,
      corePacks: corePackSummary,
    });
  } catch (error) {
    if (parsedImportJobId !== null && authorizedForJob) {
      await markImportJobFailed(
        parsedImportJobId,
        error instanceof Error ? error.message : "Unknown error",
        "preflight",
      ).catch(() => undefined);
    }

    return jsonError("Import preflight failed", error);
  }
}

function normalizeHashInputs(values: HashInput[]): Array<{
  sha256: string;
  sizeBytes: number;
}> {
  const result = new Map<string, number>();

  for (const value of values) {
    const sha256 = normalizeSha256(
      typeof value === "string" ? value : String(value.sha256 ?? ""),
    );
    const sizeBytes =
      typeof value === "string" ? 0 : readNonNegativeInteger(value.sizeBytes);

    result.set(sha256, Math.max(result.get(sha256) ?? 0, sizeBytes));
  }

  return [...result.entries()].map(([sha256, sizeBytes]) => ({
    sha256,
    sizeBytes,
  }));
}

function summarize(
  all: Array<{
    sha256: string;
    sizeBytes: number;
  }>,
  existing: Set<string>,
) {
  const existingItems = all.filter((item) => existing.has(item.sha256));
  const missingItems = all.filter((item) => !existing.has(item.sha256));

  return {
    total: all.length,
    existing: existingItems.map((item) => item.sha256),
    missing: missingItems.map((item) => item.sha256),
    existingCount: existingItems.length,
    missingCount: missingItems.length,
    existingSizeBytes: existingItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    missingSizeBytes: missingItems.reduce((sum, item) => sum + item.sizeBytes, 0),
  };
}

function readNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return 0;
  }

  return value;
}
