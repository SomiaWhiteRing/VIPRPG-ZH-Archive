import { normalizeSha256 } from "@/app/.server/crypto/sha256";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { streamValidatedImage } from "@/app/.server/storage/work-images";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    sha256: string;
  };
};

type BlobMediaRow = {
  sha256: string;
  content_type_hint: string | null;
  size_bytes: number;
};

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  try {
    const { sha256: rawSha256 } = await context.params;
    const sha256 = normalizeSha256(rawSha256);
    const row = await getD1(runtime)
      .prepare(
        `SELECT sha256, content_type_hint, size_bytes FROM blobs
         WHERE sha256=? AND status='active' AND public_at IS NOT NULL LIMIT 1`,
      )
      .bind(sha256)
      .first<BlobMediaRow>();

    if (!row) {
      return json(
        {
          ok: false,
          error: "Media blob not found",
        },
        { status: 404 },
      );
    }

    // Check current visibility before reusing an immutable, already-sniffed image.
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
    if (request.method === "GET") {
      runtime.execution.waitUntil(cache.put(cacheRequest, response.clone()).catch(() => undefined));
    }
    return response;
  } catch (error) {
    return jsonError("Media blob fetch failed", error);
  }
}
