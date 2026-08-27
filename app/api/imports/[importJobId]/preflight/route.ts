import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { requirePermission } from "@/lib/server/auth/authorize";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import {
  markImportJobFailed,
  markImportJobPreflighted,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";

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
  const auth = await requirePermission(request, "import_job.preflight_own");

  if ("response" in auth) {
    return auth.response;
  }

  const startedAt = Date.now();
  let parsedImportJobId: number | null = null;
  let authorizedForJob = false;

  try {
    const { importJobId } = await context.params;
    parsedImportJobId = parseImportJobId(importJobId);
    const job = await requiredOwnedImportJob(parsedImportJobId, auth.user);
    authorizedForJob = true;

    const payload = await parsePreflightRequest(request);
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
    const rawSha256 = typeof value === "string" ? value : value.sha256;
    if (typeof rawSha256 !== "string") {
      throw new HttpError(400, "Invalid SHA-256");
    }
    let sha256: string;
    try {
      sha256 = normalizeSha256(rawSha256);
    } catch {
      throw new HttpError(400, "Invalid SHA-256");
    }
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
    existingSizeBytes: existingItems.reduce(
      (sum, item) => sum + item.sizeBytes,
      0,
    ),
    missingSizeBytes: missingItems.reduce(
      (sum, item) => sum + item.sizeBytes,
      0,
    ),
  };
}

function readNonNegativeInteger(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, "Invalid object size");
  }
  return value;
}

async function parsePreflightRequest(
  request: Request,
): Promise<PreflightRequest> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!isRecord(value)) {
    throw new HttpError(400, "Invalid preflight body");
  }
  for (const key of ["blobs", "corePacks"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      throw new HttpError(400, `${key} must be an array`);
    }
    const values = (value[key] ?? []) as unknown[];
    for (const item of values) {
      if (typeof item === "string") continue;
      if (!isRecord(item) || typeof item.sha256 !== "string") {
        throw new HttpError(400, "Invalid object reference");
      }
      if (
        item.sizeBytes !== undefined &&
        (typeof item.sizeBytes !== "number" ||
          !Number.isSafeInteger(item.sizeBytes) ||
          item.sizeBytes < 0)
      ) {
        throw new HttpError(400, "Invalid object size");
      }
    }
  }
  return value as PreflightRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
