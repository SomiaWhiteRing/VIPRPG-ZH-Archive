import { sha256Hex } from "../lib/sha256.ts";
// A disposable, cross-colo cache of hot ZIP variants. Direct-mapped slots bound
// storage even with concurrent writers: 16 objects, each at most 256 MiB.
import { downloadCacheMaxBytes, downloadCacheMaxAgeMs, downloadCacheMinR2Gets, downloadCachePrefix, isDownloadCacheSlotKey } from "../lib/archive/download.ts";

export async function hotDownloadCache(db, cacheKey, estimatedR2GetCount = 0) {
  const row = await db.prepare(`SELECT full_download_count,range_download_count,interrupted_count,estimated_r2_get_count FROM download_builds WHERE cache_key=?`)
    .bind(cacheKey).first();
  // Expensive variants qualify on their first request. Resumes and interrupted
  // downloads also demonstrate reuse; a completed full download is not required.
  const requests = (row?.full_download_count ?? 0) + (row?.range_download_count ?? 0) + (row?.interrupted_count ?? 0);
  if (requests < 2 && Math.max(estimatedR2GetCount, row?.estimated_r2_get_count ?? 0) < downloadCacheMinR2Gets) return null;
  const digest = await sha256Hex(new TextEncoder().encode(cacheKey));
  return { digest, objectKey: `${downloadCachePrefix}${digest[0]}.zip` };
}

function cachedInterval(object, cache) {
  if (!(object && object.customMetadata?.cacheDigest === cache.digest &&
    object.size > 0 && object.size <= downloadCacheMaxBytes &&
    new Date(object.uploaded).getTime() > Date.now() - downloadCacheMaxAgeMs)) return null;
  const size = Number(object.customMetadata.zipSize);
  const start = Number(object.customMetadata.zipOffset);
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(start) || start < 0 || size < start + object.size) return null;
  return { size, start, end: start + object.size - 1 };
}

export async function readDownloadCache(bucket, cache, method, rangeHeader, parseRange) {
  // A range needs metadata first. Guard the subsequent GET against another hot
  // variant replacing this slot between HEAD and GET.
  let object;
  let range = null;
  if (method === "HEAD" || rangeHeader) {
    object = await bucket.head(cache.objectKey);
    const interval = cachedInterval(object, cache);
    if (!interval) return null;
    if (rangeHeader) {
      range = parseRange(rangeHeader, interval.size);
      if (!range) return { invalidRange: true, size: interval.size };
      if (range.start < interval.start || range.end > interval.end) return null;
      object = await bucket.get(cache.objectKey, {
        range: { offset: range.start - interval.start, length: range.end - range.start + 1 },
        onlyIf: { etagMatches: object.etag },
      });
    }
  } else object = await bucket.get(cache.objectKey);
  const interval = cachedInterval(object, cache);
  if (!interval || (method !== "HEAD" && (!object.body ||
      (!range && (interval.start !== 0 || interval.end !== interval.size - 1))))) {
    await object?.body?.cancel();
    return null;
  }
  return { body: object.body, size: interval.size, range,
    estimatedR2GetCount: Number(object.customMetadata.estimatedR2GetCount) };
}

export async function writeDownloadCache(bucket, cache, response, estimatedR2GetCount, zipSize, range) {
  const size = Number(response.headers.get("Content-Length"));
  if (!(size > 0 && size <= downloadCacheMaxBytes && Number.isSafeInteger(zipSize) &&
      (range ? range.end - range.start + 1 === size && range.start >= 0 && range.end < zipSize : zipSize === size))) {
    await response.body?.cancel();
    return;
  }
  try {
    await bucket.put(cache.objectKey, response.body, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { cacheDigest: cache.digest, estimatedR2GetCount: String(estimatedR2GetCount),
        zipSize: String(zipSize), zipOffset: String(range?.start ?? 0) },
    });
  } catch (error) {
    // A rejected PUT may never have consumed its stream. Unblock its writer.
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}

export function cacheDownloadResponse(bucket, cache, response, estimatedR2GetCount, zipSize, range, ctx) {
  const size = Number(response.headers.get("Content-Length"));
  const cached = new FixedLengthStream(size);
  const writer = cached.writable.getWriter();
  const reader = response.body.getReader();
  let caching = true;
  ctx.waitUntil(writeDownloadCache(bucket, cache, new Response(cached.readable, { headers: response.headers }),
    estimatedR2GetCount, zipSize, range).catch(async (error) => {
    caching = false;
    await writer.abort(error).catch(() => undefined);
    console.warn("Shared download cache put failed", error?.message ?? error);
  }));
  // Response.clone()/tee lets the faster consumer buffer the entire ZIP for a
  // slow client. Pull at the pace of both consumers instead, including big ZIPs.
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (caching) await writer.close().catch(() => { caching = false; });
          reader.releaseLock();
          controller.close();
        } else {
          if (caching) await writer.write(value).catch(() => { caching = false; });
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        await Promise.allSettled([reader.cancel(error), writer.abort(error)]);
      }
    },
    async cancel(reason) {
      await Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
    },
  });
  // An ordinary ReadableStream makes workerd use chunked encoding even when
  // Content-Length was supplied. Preserve the length at the public response.
  const delivered = new FixedLengthStream(size);
  ctx.waitUntil(body.pipeTo(delivered.writable).catch((error) => {
    console.warn("Shared download response stream failed", error?.message ?? error);
  }));
  return new Response(delivered.readable, { status: response.status, headers: response.headers });
}

export async function sweepDownloadCache(env) {
  const report = { scannedCount: 0, purgedCount: 0, purgedSizeBytes: 0, failedCount: 0, failed: [] };
  let objects;
  try {
    objects = await env.ARCHIVE_BUCKET.list({ prefix: "download-cache/", limit: 1000 });
  } catch (error) {
    report.failedCount++;
    report.failed.push({ key: downloadCachePrefix, error: String(error) });
    return report;
  }
  // Only v1/v2 fixed slots belong to this cache; retain other objects. v1 slots
  // age out without ever being read as a v2 interval (or vice versa on rollback).
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
