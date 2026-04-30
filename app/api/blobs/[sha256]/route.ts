import { normalizeSha256, sha256Hex, timingSafeEqualString } from "@/lib/server/crypto/sha256";
import { requireUploader } from "@/lib/server/auth/guards";
import { findExistingObjects, insertBlobRecord } from "@/lib/server/db/archive-objects";
import { json, jsonError } from "@/lib/server/http/json";
import { readContentType } from "@/lib/server/http/request";
import { putBlob } from "@/lib/server/storage/archive-bucket";
import { blobKey } from "@/lib/server/storage/archive-keys";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sha256: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireUploader(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    const existing = await findExistingObjects({
      blobSha256: [sha256],
      corePackSha256: [],
    });

    if (existing.blobs.has(sha256)) {
      return json({
        ok: true,
        status: "exists",
        sha256,
        r2Key: blobKey(sha256),
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
    const r2Object = await putBlob(sha256, body, body.byteLength, contentTypeHint);

    await insertBlobRecord({
      sha256,
      sizeBytes: body.byteLength,
      contentTypeHint,
      observedExt: null,
      r2Key: r2Object.key,
    });

    return json(
      {
        ok: true,
        status: "uploaded",
        sha256,
        sizeBytes: body.byteLength,
        r2Key: r2Object.key,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError("Blob upload failed", error);
  }
}
