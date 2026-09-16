import { requirePermission } from "@/app/.server/auth/authorize";
import {
  normalizeSha256,
  sha256Hex,
  timingSafeEqualString,
} from "@/app/.server/crypto/sha256";
import {
  prepareObjectUpload,
  recordUploadedBlob,
} from "@/app/.server/db/archive-objects";
import { parseImportJobId } from "@/app/.server/db/import-jobs";
import { readContentType } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { putBlob } from "@/app/.server/storage/archive-bucket";
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
      kind: "blob",
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

    const contentTypeHint = readContentType(request);
    await putBlob(runtime, sha256, body, body.byteLength, contentTypeHint);

    await recordUploadedBlob(runtime, {
      sha256,
      sizeBytes: body.byteLength,
      contentTypeHint,
      observedExt: null,
      importJobId,
      durationMs: Date.now() - startedAt,
    });

    return json(
      {
        ok: true,
        status: "uploaded",
        sha256,
        sizeBytes: body.byteLength,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Blob upload failed", error);
  }
}

function requiredImportJobId(request: Request): number {
  const rawImportJobId = new URL(request.url).searchParams.get("import_job_id");
  if (!rawImportJobId) throw new HttpError(400, "import_job_id is required");
  return parseImportJobId(rawImportJobId);
}
