import { requirePermission } from "@/app/.server/auth/authorize";
import {
  normalizeSha256,
  sha256Hex,
  timingSafeEqualString,
} from "@/app/.server/crypto/sha256";
import {
  prepareObjectUpload,
  recordUploadedCorePack,
} from "@/app/.server/db/archive-objects";
import { parseImportJobId } from "@/app/.server/db/import-jobs";
import { readIntegerHeader } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { putCorePack } from "@/app/.server/storage/archive-bucket";
import { HttpError, json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    sha256: string;
  };
};

export async function PUT(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const startedAt = Date.now();
  const auth = await requirePermission(
    runtime,
    request,
    "storage_object.upload",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    const importJobId = requiredImportJobId(request);
    const uploadState = await prepareObjectUpload(runtime, {
      kind: "core_pack",
      sha256,
      importJobId,
      userId: auth.user.id,
    });

    if (uploadState === "exists") {
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

    await putCorePack(runtime, sha256, body, body.byteLength);

    await recordUploadedCorePack(runtime, {
      sha256,
      sizeBytes: body.byteLength,
      uncompressedSizeBytes,
      fileCount,
      importJobId,
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

function requiredImportJobId(request: Request): number {
  const rawImportJobId = new URL(request.url).searchParams.get("import_job_id");
  if (!rawImportJobId) throw new HttpError(400, "import_job_id is required");
  return parseImportJobId(rawImportJobId);
}

function looksLikeZip(body: ArrayBuffer): boolean {
  if (body.byteLength < 4) {
    return false;
  }

  const bytes = new Uint8Array(body, 0, 4);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}
