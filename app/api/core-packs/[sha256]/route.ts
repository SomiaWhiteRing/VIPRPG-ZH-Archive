import { normalizeSha256, sha256Hex, timingSafeEqualString } from "@/lib/server/crypto/sha256";
import { requirePermission } from "@/lib/server/auth/authorize";
import { findExistingObjects, insertCorePackRecord } from "@/lib/server/db/archive-objects";
import {
  parseImportJobId,
  recordImportObjectUpload,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { readIntegerHeader } from "@/lib/server/http/request";
import { putCorePack } from "@/lib/server/storage/archive-bucket";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sha256: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  const auth = await requirePermission(request, "storage_object.upload");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    const importJobId = await requiredAuthorizedImportJobId(request, auth.user);
    const existing = await findExistingObjects({
      blobSha256: [],
      corePackSha256: [sha256],
    });

    if (existing.corePacks.has(sha256)) {
      return json({
        ok: true,
        status: "exists",
        sha256,
      });
    }

    const fileCount = readIntegerHeader(request, "x-core-pack-file-count");
    const uncompressedSizeBytes = readIntegerHeader(
      request,
      "x-core-pack-uncompressed-size",
    );
    const body = await request.arrayBuffer();
    const actualSha256 = await sha256Hex(body);

    if (!timingSafeEqualString(actualSha256, sha256)) {
      return json(
        {
          ok: false,
          error: "SHA-256 mismatch",
          expected: sha256,
          actual: actualSha256,
        },
        { status: 400 },
      );
    }

    if (!looksLikeZip(body)) {
      return json(
        {
          ok: false,
          error: "Core pack must be a ZIP file",
        },
        { status: 400 },
      );
    }

    await putCorePack(sha256, body, body.byteLength);

    await insertCorePackRecord({
      sha256,
      sizeBytes: body.byteLength,
      uncompressedSizeBytes,
      fileCount,
    });

    await recordImportObjectUpload({
      id: importJobId,
      objectKind: "core_pack",
      sizeBytes: body.byteLength,
      durationMs: Date.now() - startedAt,
    });

    return json(
      {
        ok: true,
        status: "uploaded",
        sha256,
        sizeBytes: body.byteLength,
        uncompressedSizeBytes,
        fileCount,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Core pack upload failed", error);
  }
}

async function requiredAuthorizedImportJobId(
  request: Request,
  user: Parameters<typeof requiredOwnedImportJob>[1],
): Promise<number> {
  const rawImportJobId = new URL(request.url).searchParams.get("import_job_id");
  if (!rawImportJobId) throw new HttpError(400, "import_job_id is required");

  const importJobId = parseImportJobId(rawImportJobId);
  await requiredOwnedImportJob(importJobId, user);
  return importJobId;
}

function looksLikeZip(body: ArrayBuffer): boolean {
  if (body.byteLength < 4) {
    return false;
  }

  const bytes = new Uint8Array(body, 0, 4);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}
