import { normalizeSha256 } from "@/lib/sha256";
import type { AppRuntime } from "@/app/.server/runtime";
import { streamValidatedImage } from "@/app/.server/storage/work-images";
import { jsonError } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { workReadCondition } from "@/app/.server/db/work-visibility";

type RouteContext = {
  params: {
    sha256: string;
  };
};

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    // Existing public hashes remain public; newly restricted work images must
    // pass authorization before looking at any previously populated cache.
    const references = `SELECT wm.work_id FROM work_media_assets wm JOIN media_assets ma ON ma.id=wm.media_asset_id WHERE ma.blob_sha256=?
      UNION SELECT wc.work_id FROM work_characters wc JOIN character_portrait_refs ref ON ref.id=wc.portrait_ref_id
        JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE fs.blob_sha256=?`;
    const restricted = await runtime.db.prepare(`SELECT 1 FROM blobs b WHERE b.sha256=? AND b.public_at IS NULL
      AND (EXISTS(SELECT 1 FROM media_assets ma WHERE ma.blob_sha256=b.sha256)
        OR EXISTS(SELECT 1 FROM works w WHERE w.id IN (${references}) AND (w.audience<>'public' OR w.status<>'published')))`)
      .bind(sha256, sha256, sha256).first();
    if (restricted) {
      const access = workReadCondition(await getCurrentUser(runtime));
      if (!await runtime.db.prepare(`SELECT 1 FROM works w WHERE w.id IN (${references}) AND ${access.sql}`)
        .bind(sha256, sha256, ...access.binds).first()) throw new HttpError(404, "图片不存在或无权访问");
      const object = await streamValidatedImage(runtime, sha256);
      if (request.method === "HEAD") await object.body.cancel();
      return new Response(request.method === "HEAD" ? null : object.body, { headers: {
        "Cache-Control": "private, no-store", "Vary": "Cookie", "Content-Type": object.contentType,
        "Content-Length": String(object.size), "X-Content-Type-Options": "nosniff",
      } });
    }
    // Content-addressed images are readable while the object or its cache exists.
    const cache = await caches.open("public-images-v1");
    const cacheRequest = new Request(new URL(`/api/media/blobs/${sha256}`, runtime.origin));
    const cached = await cache.match(cacheRequest).catch(() => undefined);
    if (cached) {
      if (request.method !== "HEAD") return cached;
      await cached.body?.cancel();
      return new Response(null, { headers: cached.headers });
    }
    const object = await streamValidatedImage(runtime, sha256);

    const response = new Response(object.body, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(object.size),
        "Content-Type": object.contentType,
        "X-Content-Type-Options": "nosniff",
        ETag: `"blob-${sha256}"`,
      },
    });
    if (request.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, { headers: response.headers });
    }
    if (request.method === "GET") {
      runtime.execution.waitUntil(cache.put(cacheRequest, response.clone()).catch(() => undefined));
    }
    return response;
  } catch (error) {
    return jsonError("Media blob fetch failed", error);
  }
}
