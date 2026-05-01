import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { requireUploader } from "@/lib/server/auth/guards";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import {
  assertImportJobAccess,
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
  blobs?: string[];
  corePacks?: string[];
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { importJobId } = await context.params;
    const job = await requiredImportJob(parseImportJobId(importJobId));
    assertImportJobAccess(job, auth.user);

    const payload = (await request.json()) as PreflightRequest;
    const blobSha256 = normalizeHashList(payload.blobs ?? []);
    const corePackSha256 = normalizeHashList(payload.corePacks ?? []);
    const existing = await findExistingObjects({
      blobSha256,
      corePackSha256,
    });
    const blobSummary = summarize(blobSha256, existing.blobs);
    const corePackSummary = summarize(corePackSha256, existing.corePacks);

    await markImportJobPreflighted({
      id: job.id,
      missingBlobCount: blobSummary.missingCount,
      missingCorePackCount: corePackSummary.missingCount,
    });

    return json({
      ok: true,
      importJobId: job.id,
      blobs: blobSummary,
      corePacks: corePackSummary,
    });
  } catch (error) {
    return jsonError("Import preflight failed", error);
  }
}

function normalizeHashList(values: string[]): string[] {
  return [...new Set(values.map(normalizeSha256))];
}

function summarize(all: string[], existing: Set<string>) {
  const existingItems = all.filter((sha256) => existing.has(sha256));
  const missingItems = all.filter((sha256) => !existing.has(sha256));

  return {
    total: all.length,
    existing: existingItems,
    missing: missingItems,
    existingCount: existingItems.length,
    missingCount: missingItems.length,
  };
}
