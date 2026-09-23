const coverCacheName = "viprpg-web-play-covers-v1";

export async function readCachedWebPlayCover(sha256: string): Promise<Blob | null> {
  const cache = await caches.open(coverCacheName);
  const response = await cache.match(coverUrl(sha256));
  return response ? response.blob() : null;
}

function coverUrl(sha256: string): string {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Invalid cover hash");
  return `/api/media/blobs/${sha256.toLowerCase()}`;
}

export async function cacheWebPlayCover(sha256: string): Promise<Blob> {
  const url = coverUrl(sha256);
  const cache = await caches.open(coverCacheName);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) {
      throw new Error("Cover unavailable");
    }
    await cache.put(url, response.clone());
  }
  return response.blob();
}

export async function deleteUnusedWebPlayCovers(
  removed: Array<string | null | undefined>,
  retained: Array<string | null | undefined>,
): Promise<void> {
  const remaining = new Set(retained.filter(Boolean));
  const cache = await caches.open(coverCacheName);
  for (const sha256 of new Set(removed.filter(Boolean))) {
    if (sha256 && !remaining.has(sha256)) await cache.delete(coverUrl(sha256));
  }
}
