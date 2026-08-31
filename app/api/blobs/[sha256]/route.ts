import {
  normalizeSha256,
  sha256Hex,
  timingSafeEqualString,
} from "@/lib/server/crypto/sha256";
import { requirePermission } from "@/lib/server/auth/authorize";
import {
  prepareObjectUpload,
  recordUploadedBlob,
} from "@/lib/server/db/archive-objects";
import { parseImportJobId } from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { readContentType } from "@/lib/server/http/request";
import { putBlob } from "@/lib/server/storage/archive-bucket";

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
    const importJobId = requiredImportJobId(request);
    const uploadState = await prepareObjectUpload({
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
    await putBlob(sha256, body, body.byteLength, contentTypeHint);

    await recordUploadedBlob({
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
