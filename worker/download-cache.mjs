import { sha256Hex } from "../lib/sha256.ts";
// A disposable, cross-colo cache of hot ZIP variants. Direct-mapped segments
// bound storage to 4 GiB even with concurrent writers.
import { downloadCacheMaxBytes, downloadCacheMaxAgeMs, downloadCacheMinR2Gets, downloadCachePrefix, isDownloadCacheSlotKey } from "../lib/archive/download.ts";

// Store only slot names, never another request's I/O or streams. At most 256
// entries per bucket. Other isolates still rely on recent-object protection.
const pendingWrites = new WeakMap();

export async function hotDownloadCache(db, cacheKey, estimatedR2GetCount = 0) {
  const row = estimatedR2GetCount >= downloadCacheMinR2Gets ? null : await db.prepare(
    `SELECT full_download_count,range_download_count,interrupted_count,estimated_r2_get_count FROM download_builds WHERE cache_key=? AND last_accessed_at>datetime('now','-1 day')`)
    .bind(cacheKey).first();
  // Expensive variants qualify on their first request. Resumes and interrupted
  // downloads also demonstrate reuse; a completed full download is not required.
  const requests = (row?.full_download_count ?? 0) + (row?.range_download_count ?? 0) + (row?.interrupted_count ?? 0);
  if (requests < 2 && Math.max(estimatedR2GetCount, row?.estimated_r2_get_count ?? 0) < downloadCacheMinR2Gets) return null;
  const digest = await sha256Hex(new TextEncoder().encode(cacheKey));
  return { digest, slots: [downloadCacheSegment({ digest }, 0)] };
}

export function downloadCacheSegment(cache, offset) {
  const hash = Number.parseInt(cache.digest.slice(0, 8), 16);
  const index = (hash + Math.floor(offset / downloadCacheMaxBytes)) % 256;
  return { objectKey: `${downloadCachePrefix}${index.toString(16).padStart(2, "0")}.zip`, maxBytes: downloadCacheMaxBytes };
}

function cachedInterval(object, cache, maxBytes) {
  if (!(object && object.customMetadata?.cacheDigest === cache.digest &&
    object.size > 0 && object.size <= maxBytes &&
    new Date(object.uploaded).getTime() > Date.now() - downloadCacheMaxAgeMs)) return null;
  const size = Number(object.customMetadata.zipSize);
  const start = Number(object.customMetadata.zipOffset);
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(start) || start < 0 || size < start + object.size) return null;
  return { size, start, end: start + object.size - 1 };
}

export async function readDownloadCache(bucket, cache, method, rangeHeader, parseRange) {
  const start = /^bytes=(\d+)-/.exec(rangeHeader ?? "")?.[1];
  const hash = Number.parseInt(cache.digest.slice(0, 2), 16);
  // Existing v3 objects remain useful during the seven-day transition/rollback
  // window. New writes use only v4; the existing sweep retires old slots.
  const slots = [downloadCacheSegment(cache, Number(start ?? 0)),
    { objectKey: `download-cache/v3/slots/small/${(hash % 32).toString(16).padStart(2, "0")}.zip`, maxBytes: 64 * 1024 * 1024 },
    { objectKey: `download-cache/v3/slots/large/${(hash % 8).toString(16)}.zip`, maxBytes: 256 * 1024 * 1024 }];
  for (const slot of slots) {
    const result = await readSlot(bucket, { digest: cache.digest, ...slot }, method, rangeHeader, parseRange);
    if (result) return result;
  }
  return null;
}

async function readSlot(bucket, cache, method, rangeHeader, parseRange, prepared) {
  // A range needs metadata first. Guard the subsequent GET against another hot
  // variant replacing this slot between HEAD and GET.
  let object;
  let range = null;
  let originalStart;
  if (method === "HEAD" || rangeHeader) {
    object = prepared ?? await bucket.head(cache.objectKey);
    const interval = cachedInterval(object, cache, cache.maxBytes);
    if (!interval) return null;
    if (rangeHeader) {
      range = parseRange(rangeHeader, interval.size);
      if (!range) return { invalidRange: true, size: interval.size };
      if (range.start < interval.start || range.end > interval.end) return null;
      originalStart = interval.start;
      object = await bucket.get(cache.objectKey, {
        range: { offset: range.start - interval.start, length: range.end - range.start + 1 },
        onlyIf: { etagMatches: object.etag },
      });
    }
  } else {
    const metadata = await bucket.head(cache.objectKey);
    const interval = cachedInterval(metadata, cache, cache.maxBytes);
    if (!interval || interval.start !== 0 || interval.end !== interval.size - 1) return null;
    object = await bucket.get(cache.objectKey, { onlyIf: { etagMatches: metadata.etag } });
  }
  const interval = cachedInterval(object, cache, cache.maxBytes);
  if (!interval || (range && (interval.start !== originalStart || range.end > interval.end)) ||
      (method !== "HEAD" && (!object.body ||
      (!range && (interval.start !== 0 || interval.end !== interval.size - 1))))) {
    await object?.body?.cancel();
    return null;
  }
  return { body: object.body, size: interval.size, range,
    estimatedR2GetCount: Number(object.customMetadata.estimatedR2GetCount) };
}

export async function createCachedDownloadStream(bucket, readBucket, cache, zipSize, range, build, estimatedR2GetCount, ctx, metrics) {
  const start = range?.start ?? 0;
  const end = range?.end ?? zipSize - 1;
  const parts = [];
  for (let offset = start; offset <= end;) {
    const part = { start: offset, end: Math.min(end, (Math.floor(offset / downloadCacheMaxBytes) + 1) * downloadCacheMaxBytes - 1) };
    const slot = downloadCacheSegment(cache, offset);
    let object;
    try {
      object = await readBucket.head(slot.objectKey);
      const interval = cachedInterval(object, cache, slot.maxBytes);
      if (!interval || interval.size !== zipSize || interval.start > part.start || interval.end < part.end) object = null;
    } catch (error) {
      console.warn("Shared download segment metadata failed", error?.message ?? error);
    }
    parts.push({ part, slot, object });
    offset = part.end + 1;
  }
  const { readable, writable } = new FixedLengthStream(end - start + 1);
  const writer = writable.getWriter();
  const completion = (async () => {
    try {
      for (const { part, slot, object } of parts) {
        let cached;
        try {
          cached = object && await readSlot(readBucket, { digest: cache.digest, ...slot }, "GET",
            `bytes=${part.start}-${part.end}`, () => part, object);
          if (cached && cached.size !== zipSize) {
            await cached.body?.cancel();
            cached = null;
          }
        } catch (error) {
          console.warn("Shared download segment read failed", error?.message ?? error);
        }
        let response;
        let built;
        if (cached) {
          response = new Response(cached.body);
        } else {
          built = build(part);
          // Attach a rejection handler before awaiting storage metadata.
          built.completion.catch(() => undefined);
          response = await cacheDownloadResponse(bucket, { digest: cache.digest, slots: [slot] },
            new Response(built.readable, { headers: { "Content-Length": String(part.end - part.start + 1) } }),
            estimatedR2GetCount, zipSize, part, ctx);
        }
        const reader = response.body.getReader();
        let delivered = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            delivered += value.byteLength;
            if (delivered > part.end - part.start + 1) throw new Error("Cached ZIP segment overflow");
            await writer.write(value);
            if (cached) metrics.cachedBytes += value.byteLength;
          }
          if (delivered !== part.end - part.start + 1) throw new Error("Cached ZIP segment underflow");
          if (built) await built.completion;
        } catch (error) {
          await reader.cancel(error).catch(() => undefined);
          throw error;
        } finally { reader.releaseLock(); }
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      throw error;
    } finally { writer.releaseLock(); }
  })();
  return { readable, completion, allCached: parts.every((part) => Boolean(part.object)) };
}

export async function writeDownloadCache(bucket, cache, response, estimatedR2GetCount, zipSize, range) {
  const size = Number(response.headers.get("Content-Length"));
  if (!(size > 0 && size <= cache.maxBytes && Number.isSafeInteger(zipSize) &&
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

export async function cacheDownloadResponse(bucket, cache, response, estimatedR2GetCount, zipSize, range, ctx) {
  const size = Number(response.headers.get("Content-Length"));
  const slot = cache.slots.find((candidate) => size > 0 && size <= candidate.maxBytes);
  if (!slot) return response;
  let pending = pendingWrites.get(bucket);
  if (!pending) pendingWrites.set(bucket, pending = new Set());
  if (pending.has(slot.objectKey)) return response;
  pending.add(slot.objectKey);
  try {
    // Avoid replacing a freshly completed object across isolates. Also preserve
    // wider intervals of this immutable variant when a concurrent build ends.
    const object = await bucket.head(slot.objectKey);
    const age = object ? Date.now() - new Date(object.uploaded).getTime() : Infinity;
    const interval = cachedInterval(object, cache, slot.maxBytes);
    if (age < 1000 || (object?.customMetadata?.cacheDigest !== cache.digest && age < 60_000) ||
        (interval && interval.start <= (range?.start ?? 0) && interval.end >= (range?.end ?? zipSize - 1))) {
      pending.delete(slot.objectKey);
      return response;
    }
  } catch (error) {
    pending.delete(slot.objectKey);
    console.warn("Shared download cache write check failed", error?.message ?? error);
    return response;
  }
  const cached = new FixedLengthStream(size);
  const writer = cached.writable.getWriter();
  const reader = response.body.getReader();
  let caching = true;
  ctx.waitUntil(writeDownloadCache(bucket, { digest: cache.digest, ...slot }, new Response(cached.readable, { headers: response.headers }),
    estimatedR2GetCount, zipSize, range).catch(async (error) => {
    caching = false;
    await writer.abort(error).catch(() => undefined);
    console.warn("Shared download cache put failed", error?.message ?? error);
  }).finally(() => pending.delete(slot.objectKey)));
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
  // Only recognized fixed slots belong to this cache; retain other objects.
  // Prior layouts age out normally and remain available on a code rollback.
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
