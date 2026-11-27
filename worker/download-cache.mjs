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
  const slot = downloadCacheSegment(cache, Number(start ?? 0));
  return readSlot(bucket, { digest: cache.digest, ...slot }, method, rangeHeader, parseRange);
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

// Share game file bodies across ZIP layouts. Headers and ZIP offsets always belong to the target.
export async function webPlayCacheSource(bucket, request, layout, range, budget, etag, metrics) {
  const windowBytes = 2 * 1024 * 1024;
  const windows = new Map();
  for (const entry of layout.entries) {
    if (entry.webOffset === undefined || !entry.size) continue;
    const from = entry.webOffset + Math.max(0, (range?.start ?? 0) - entry.dataStart);
    const end = entry.webOffset + Math.min(entry.size, (range?.end ?? layout.size) + 1 - entry.dataStart);
    for (let pos = from; pos < end;) {
      const index = Math.floor(pos / windowBytes);
      const next = Math.min(end, (index + 1) * windowBytes);
      const prior = windows.get(index);
      windows.set(index, { start: Math.min(pos, prior?.start ?? pos), end: Math.max(next, prior?.end ?? next) });
      pos = next;
    }
  }
  // Keep the original source-read budget available for a fully cold fallback.
  // A split at a donor boundary can require an extra source read as well as the cache lookup.
  if (!windows.size || budget < 8) return null;
  const cache = { digest: await sha256Hex(new TextEncoder().encode(new URL(request.url).pathname)) };
  const slots = new Map();
  const buffers = new Map();
  let edgeAvailable;

  async function edgeRange(start, end) {
    const response = await caches.default.match(new Request(request, { headers: { Range: `bytes=${start}-${end - 1}` } }));
    if (response?.status === 206 && response.headers.get("ETag") === etag &&
        response.headers.get("Content-Range") === `bytes ${start}-${end - 1}/${layout.webSize}`) return response;
    await response?.body?.cancel();
    return null;
  }

  async function locate(offset) {
    // Ordinary ZIP cache hits never enter this path. Probe the local edge only once on first use.
    edgeAvailable ??= edgeRange(offset, offset + 1).then(async response => {
      await response?.body?.cancel();
      return Boolean(response);
    }).catch(() => false);
    if (await edgeAvailable) return { start: 0, end: layout.webSize };
    const slot = downloadCacheSegment(cache, offset);
    const index = Math.floor(offset / downloadCacheMaxBytes);
    if (!slots.has(index)) {
      if (--budget < 1) return null;
      slots.set(index, bucket.head(slot.objectKey).then(object => {
        const interval = cachedInterval(object, cache, slot.maxBytes);
        return interval?.size === layout.webSize && Math.floor(interval.start / downloadCacheMaxBytes) === index
          ? { start: interval.start, end: interval.end + 1, slot, object } : null;
      }).catch(() => null));
    }
    return slots.get(index);
  }

  async function load(index, donor) {
    if (buffers.has(index)) return buffers.get(index);
    if (--budget < 1) return null;
    const window = windows.get(index);
    const start = Math.max(window.start, donor.start), end = Math.min(window.end, donor.end);
    const pending = (async () => {
      const object = donor.slot ? await bucket.get(donor.slot.objectKey, {
        range: { offset: start - donor.start, length: end - start }, onlyIf: { etagMatches: donor.object.etag },
      }) : await edgeRange(start, end);
      if (!object?.body) return null;
      if (donor.slot) {
        const interval = cachedInterval(object, cache, donor.slot.maxBytes);
        if (interval?.size !== layout.webSize || interval.start !== donor.start || interval.end + 1 < end) {
          await object.body.cancel();
          return null;
        }
      }
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
      return bytes.length === end - start ? { start, bytes } : null;
    })().catch(() => null);
    buffers.set(index, pending);
    if (buffers.size > 2) buffers.delete(buffers.keys().next().value);
    return pending;
  }

  return { async open(offset, size, part, original) {
    const start = offset + (part?.offset ?? 0), end = start + (part?.length ?? size);
    const pieces = [];
    for (let pos = start; pos < end;) {
      const slotEnd = Math.min(end, (Math.floor(pos / downloadCacheMaxBytes) + 1) * downloadCacheMaxBytes);
      const donor = await locate(pos);
      const lo = Math.max(pos, donor?.start ?? slotEnd), hi = Math.min(slotEnd, donor?.end ?? pos);
      if (lo < hi) {
        if (pos < lo) pieces.push({ start: pos, end: lo });
        for (let at = lo; at < hi;) {
          const index = Math.floor(at / windowBytes);
          const next = Math.min(hi, (index + 1) * windowBytes);
          pieces.push({ start: at, end: next, index, donor });
          at = next;
        }
        if (hi < slotEnd) pieces.push({ start: hi, end: slotEnd });
      } else pieces.push({ start: pos, end: slotEnd });
      pos = slotEnd;
    }
    if (!pieces.some(piece => piece.donor) || budget < pieces.length + 1) return original(part);
    budget -= pieces.length - 1;
    let i = 0, reader;
    return new ReadableStream({
      async pull(controller) {
        while (i < pieces.length || reader) {
          if (reader) {
            const chunk = await reader.read();
            if (!chunk.done) { controller.enqueue(chunk.value); return; }
            reader.releaseLock();
            reader = null;
            continue;
          }
          const piece = pieces[i++], length = piece.end - piece.start;
          const window = piece.donor && await load(piece.index, piece.donor);
          if (window) {
            metrics.cachedBytes += length;
            controller.enqueue(window.bytes.subarray(piece.start - window.start, piece.end - window.start));
            return;
          }
          reader = (await original(length === size ? null : { offset: piece.start - offset, length })).getReader();
        }
        controller.close();
      },
      async cancel(reason) { await reader?.cancel(reason); },
    }, { highWaterMark: 0 });
  } };
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
