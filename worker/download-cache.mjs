// A disposable, cross-colo cache of hot ZIP variants. Direct-mapped slots bound
// storage even with concurrent writers: 16 objects, each at most 64 MiB.
import { downloadCacheMaxBytes, downloadCacheMaxAgeMs, downloadCachePrefix, isDownloadCacheSlotKey } from "../lib/archive/download.ts";

export async function hotDownloadCache(db, cacheKey) {
  const row = await db.prepare(`SELECT full_download_count,size_bytes FROM download_builds WHERE cache_key=?`)
    .bind(cacheKey).first();
  if (!(row?.full_download_count >= 2 && row.size_bytes > 0 && row.size_bytes <= downloadCacheMaxBytes)) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheKey));
  const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { digest, objectKey: `${downloadCachePrefix}${digest[0]}.zip` };
}

function matches(object, cache) {
  return object && object.customMetadata?.cacheDigest === cache.digest &&
    object.size > 0 && object.size <= downloadCacheMaxBytes &&
    new Date(object.uploaded).getTime() > Date.now() - downloadCacheMaxAgeMs;
}

export async function readDownloadCache(bucket, cache, method, rangeHeader, parseRange) {
  // A range needs metadata first. Guard the subsequent GET against another hot
  // variant replacing this slot between HEAD and GET.
  let object;
  let range = null;
  if (method === "HEAD" || rangeHeader) {
    object = await bucket.head(cache.objectKey);
    if (!matches(object, cache)) return null;
    if (rangeHeader) {
      range = parseRange(rangeHeader, object.size);
      if (!range) return { invalidRange: true, size: object.size };
      object = await bucket.get(cache.objectKey, {
        range: { offset: range.start, length: range.end - range.start + 1 },
        onlyIf: { etagMatches: object.etag },
      });
    }
  } else object = await bucket.get(cache.objectKey);
  if (!matches(object, cache) || (method !== "HEAD" && !object.body)) {
    await object?.body?.cancel();
    return null;
  }
  return { body: object.body, size: object.size, range,
    estimatedR2GetCount: Number(object.customMetadata.estimatedR2GetCount) };
}

export async function writeDownloadCache(bucket, cache, response, estimatedR2GetCount) {
  const size = Number(response.headers.get("Content-Length"));
  if (!(size > 0 && size <= downloadCacheMaxBytes)) {
    await response.body?.cancel();
    return;
  }
  try {
    await bucket.put(cache.objectKey, response.body, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { cacheDigest: cache.digest, estimatedR2GetCount: String(estimatedR2GetCount) },
    });
  } catch (error) {
    // A rejected PUT may never have consumed its tee branch. Release it while
    // the other branch continues serving the client.
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}

export async function sweepDownloadCache(env) {
  const report = { scannedCount: 0, purgedCount: 0, purgedSizeBytes: 0, failedCount: 0, failed: [] };
  let objects;
  try {
    objects = await env.ARCHIVE_BUCKET.list({ prefix: downloadCachePrefix, limit: 1000 });
  } catch (error) {
    report.failedCount++;
    report.failed.push({ key: downloadCachePrefix, error: String(error) });
    return report;
  }
  // Only the 16 fixed slots belong to this cache. Original archives, manifests,
  // blobs and player artifacts are never deletion candidates here.
  for (const object of objects.objects) {
    if (!isDownloadCacheSlotKey(object.key)) continue;
    report.scannedCount++;
    if (new Date(object.uploaded).getTime() > Date.now() - downloadCacheMaxAgeMs) continue;
    try {
      await env.ARCHIVE_BUCKET.delete(object.key);
      report.purgedCount++;
      report.purgedSizeBytes += object.size;
    } catch (error) {
      report.failedCount++;
      report.failed.push({ key: object.key, error: String(error) });
    }
  }
  return report;
}
