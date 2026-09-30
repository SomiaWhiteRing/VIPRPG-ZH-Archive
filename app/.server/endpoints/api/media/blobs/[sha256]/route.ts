import { normalizeSha256 } from "@/app/.server/crypto/sha256";
import type { AppRuntime } from "@/app/.server/runtime";
import { streamValidatedImage } from "@/app/.server/storage/work-images";
import { jsonError } from "@/lib/http";

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
