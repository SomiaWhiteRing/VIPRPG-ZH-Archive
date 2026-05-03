import { normalizeSha256 } from "@/lib/server/crypto/sha256";
import { getD1 } from "@/lib/server/db/d1";
import { json, jsonError } from "@/lib/server/http/json";
import { getBlob } from "@/lib/server/storage/archive-bucket";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sha256: string;
  }>;
};

type BlobMediaRow = {
  sha256: string;
  content_type_hint: string | null;
  size_bytes: number;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    const row = await getD1()
      .prepare(
        `SELECT sha256, content_type_hint, size_bytes
        FROM blobs
        WHERE sha256 = ?
          AND status = 'active'
        LIMIT 1`,
      )
      .bind(sha256)
      .first<BlobMediaRow>();

    if (!row || !isSafeImageType(row.content_type_hint)) {
      return json(
        {
          ok: false,
          error: "Media blob not found",
        },
        { status: 404 },
      );
    }

    const object = await getBlob(sha256);

    if (!object) {
      return json(
        {
          ok: false,
          error: "Media object missing",
        },
        { status: 404 },
      );
    }

    return new Response(object.body, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(row.size_bytes),
        "Content-Type": row.content_type_hint ?? "application/octet-stream",
        "ETag": `"blob-${sha256}"`,
      },
    });
  } catch (error) {
    return jsonError("Media blob fetch failed", error);
  }
}

function isSafeImageType(contentType: string | null): boolean {
  return Boolean(contentType?.toLowerCase().startsWith("image/"));
}
