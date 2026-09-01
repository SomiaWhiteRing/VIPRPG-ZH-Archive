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
        `SELECT b.sha256, b.content_type_hint, b.size_bytes
        FROM blobs b
        WHERE b.sha256 = ?
          AND b.status = 'active'
          AND (
            EXISTS (
              SELECT 1
              FROM media_assets ma
              JOIN work_media_assets wma ON wma.media_asset_id = ma.id
              JOIN works w ON w.id = wma.work_id
              WHERE ma.blob_sha256 = b.sha256
                AND w.status = 'published'
            )
            OR EXISTS (
              SELECT 1
              FROM custom_emojis ce
              WHERE ce.image_blob_sha256 = b.sha256
                AND ce.status IN ('active', 'retired')
            )
            OR EXISTS (
              SELECT 1
              FROM users u
              WHERE u.avatar_blob_sha256 = b.sha256
                AND u.status = 'active'
            )
            OR EXISTS (
              SELECT 1
              FROM catalogs c
              WHERE c.cover_blob_sha256 = b.sha256
                AND c.status = 'published'
            )
            OR EXISTS (
              SELECT 1
              FROM face_sheets fs
              WHERE fs.blob_sha256 = b.sha256
                AND (
                  fs.library_status = 'approved'
                  OR EXISTS (
                    SELECT 1
                    FROM character_portrait_refs cpr
                    JOIN work_characters wc ON wc.portrait_ref_id = cpr.id
                    JOIN works w ON w.id = wc.work_id
                    WHERE cpr.face_sheet_id = fs.id
                      AND w.status = 'published'
                  )
                )
            )
          )
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
