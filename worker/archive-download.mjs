import { unzipSync } from "fflate";

const downloadZipBuilderVersion = "zip-store-v7-local-crc-no-descriptor";
const manifestSchema = "viprpg-archive.manifest.v1";
const textEncoder = new TextEncoder();
const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipFlagUtf8 = 0x0800;
const zipMethodStore = 0;
const zipVersion20 = 20;
const uint16Max = 0xffff;
const uint32Max = 0xffffffff;
const zipEntryOpenPrefetch = 32;
const blobReadCacheMaxEntryBytes = 2 * 1024 * 1024;
const blobReadCacheMaxTotalBytes = 64 * 1024 * 1024;

export async function maybeHandleArchiveDownload(request, env, ctx) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const match = /^\/api\/archive-versions\/(\d+)\/download\/?$/.exec(url.pathname);

  if (!match) {
    return null;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
      },
    });
  }

  let record = null;
  let cacheKey = null;

  try {
    record = await getDownloadRecord(env.DB, Number(match[1]));

    if (!record) {
      return request.method === "HEAD"
        ? new Response(null, { status: 404 })
        : Response.json({ ok: false, error: "Archive version not found" }, { status: 404 });
    }

    const cacheRequest = downloadCacheRequest(request, record);
    cacheKey = downloadBuildCacheKey(cacheRequest);
    const bypassDownloadCache = shouldBypassDownloadCache(request, env);

    if (request.method === "GET" && !bypassDownloadCache) {
      const cached = await caches.default.match(cacheRequest);

      if (cached) {
        ctx.waitUntil(
          recordDownloadAccess(env.DB, {
            record,
            cacheKey,
            cacheStatus: "HIT",
            sizeBytes: numberHeader(cached.headers.get("Content-Length")) ?? record.totalSizeBytes,
            actualR2GetCount: 0,
            durationMs: Date.now() - startedAt,
          }),
        );

        return cached;
      }
    }

    const manifest = await loadManifest(env.ARCHIVE_BUCKET, record.manifestSha256);
    const zipEntries = buildZipEntries(manifest, env.ARCHIVE_BUCKET);
    const zipSizeBytes = estimateZipStreamSize(zipEntries);
    const cacheStatus =
      request.method === "HEAD" || bypassDownloadCache ? "BYPASS" : "MISS";
    const headers = downloadHeaders(record, cacheStatus, zipSizeBytes);

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    const response = new Response(createFixedLengthZipStream(zipEntries, zipSizeBytes), {
      headers,
    });
    const recordMissAccess = recordDownloadAccess(env.DB, {
      record,
      cacheKey,
      cacheStatus,
      sizeBytes: zipSizeBytes,
      actualR2GetCount: record.estimatedR2GetCount,
      durationMs: Date.now() - startedAt,
    });

    if (!bypassDownloadCache && shouldTryWorkersCache(record.totalSizeBytes)) {
      ctx.waitUntil(
        caches.default
          .put(cacheRequest, withDownloadCacheHeader(response.clone(), "HIT"))
          .then(() => recordMissAccess)
          .then(() => markDownloadCachePut(env.DB, cacheKey))
          .catch((error) => {
            console.warn("Native download cache put failed", error?.message ?? error);
          }),
      );
    }

    ctx.waitUntil(recordMissAccess);

    return response;
  } catch (error) {
    if (record && cacheKey) {
      ctx.waitUntil(
        recordDownloadFailure(env.DB, {
          record,
          cacheKey,
          durationMs: Date.now() - startedAt,
          errorMessage: error?.message ?? "Unknown error",
        }),
      );
    }

    console.error("Native archive download failed", error?.message ?? error);

    return request.method === "HEAD"
      ? new Response(null, { status: 500 })
      : Response.json(
          {
            ok: false,
            error: "Archive download failed",
            detail: error?.message ?? "Unknown error",
          },
          { status: 500 },
        );
  }
}

async function getDownloadRecord(db, archiveVersionId) {
  if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId <= 0) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        av.archive_label,
        av.archive_key,
        av.manifest_sha256,
        av.manifest_r2_key,
        av.packer_version,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        r.release_label,
        w.slug AS work_slug,
        w.original_title AS work_original_title,
        w.chinese_title AS work_chinese_title
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      WHERE av.id = ?
        AND av.status = 'published'
        AND r.status <> 'deleted'
        AND w.status <> 'deleted'
      LIMIT 1`,
    )
    .bind(archiveVersionId)
    .first();

  if (!row?.work_original_title) {
    return null;
  }

  return {
    id: row.id,
    releaseLabel: row.release_label,
    archiveLabel: row.archive_label,
    manifestSha256: row.manifest_sha256,
    packerVersion: row.packer_version,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    workOriginalTitle: row.work_original_title,
    workChineseTitle: row.work_chinese_title,
  };
}

async function loadManifest(bucket, manifestSha256) {
  const object = await bucket.get(manifestKey(manifestSha256));

  if (!object) {
    throw new Error(`Missing manifest object: ${manifestSha256}`);
  }

  const jsonText = await object.text();
  const actualSha256 = await sha256Hex(new TextEncoder().encode(jsonText).buffer);

  if (actualSha256 !== manifestSha256) {
    throw new Error(`Manifest SHA-256 mismatch: ${manifestSha256}`);
  }

  const manifest = JSON.parse(jsonText);

  if (manifest.schema !== manifestSchema) {
    throw new Error(`Unsupported manifest schema: ${manifest.schema}`);
  }

  return manifest;
}

function buildZipEntries(manifest, bucket) {
  const corePackCache = new Map();
  const blobReadCache = new BlobReadCache(bucket);

  return manifest.files
    .slice()
    .sort(compareManifestFiles)
    .map((file) => ({
      path: file.path,
      size: file.size,
      crc32: file.crc32,
      mtimeMs: file.mtimeMs,
      open: () => openManifestFile(file, manifest, bucket, corePackCache, blobReadCache),
    }));
}

function compareManifestFiles(left, right) {
  return (left.pathSortKey || left.path.toLowerCase()).localeCompare(
    right.pathSortKey || right.path.toLowerCase(),
  );
}

async function openManifestFile(file, manifest, bucket, corePackCache, blobReadCache) {
  const storage = file.storage;

  if (storage.kind === "blob") {
    return blobReadCache.open(storage.blobSha256, file.size);
  }

  const corePack = manifest.corePacks.find((item) => item.id === storage.packId);

  if (!corePack) {
    throw new Error(`Missing core pack declaration: ${storage.packId}`);
  }

  let entriesPromise = corePackCache.get(corePack.sha256);

  if (!entriesPromise) {
    entriesPromise = loadCorePackEntries(bucket, corePack.sha256);
    corePackCache.set(corePack.sha256, entriesPromise);
  }

  const entries = await entriesPromise;
  const bytes = entries.get(storage.entry);

  if (!bytes) {
    throw new Error(`Missing core pack entry: ${storage.entry}`);
  }

  return streamBytes(bytes);
}

class BlobReadCache {
  constructor(bucket) {
    this.bucket = bucket;
    this.promises = new Map();
    this.reservedBytes = 0;
  }

  async open(sha256, size) {
    if (!this.shouldCache(size)) {
      const object = await this.bucket.get(blobKey(sha256));

      if (!object?.body) {
        throw new Error(`Missing blob object: ${sha256}`);
      }

      return object.body;
    }

    let promise = this.promises.get(sha256);

    if (!promise) {
      this.reservedBytes += size;
      promise = this.loadBytes(sha256, size).catch((error) => {
        this.reservedBytes -= size;
        this.promises.delete(sha256);
        throw error;
      });
      promise.catch(() => undefined);
      this.promises.set(sha256, promise);
    }

    return streamBytes(await promise);
  }

  shouldCache(size) {
    return (
      Number.isSafeInteger(size) &&
      size >= 0 &&
      size <= blobReadCacheMaxEntryBytes &&
      this.reservedBytes + size <= blobReadCacheMaxTotalBytes
    );
  }

  async loadBytes(sha256, expectedSize) {
    const object = await this.bucket.get(blobKey(sha256));

    if (!object) {
      throw new Error(`Missing blob object: ${sha256}`);
    }

    const bytes = new Uint8Array(await object.arrayBuffer());

    if (bytes.byteLength !== expectedSize) {
      throw new Error(
        `Blob size mismatch for ${sha256}: expected ${expectedSize}, got ${bytes.byteLength}`,
      );
    }

    return bytes;
  }
}

async function loadCorePackEntries(bucket, sha256) {
  const object = await bucket.get(corePackKey(sha256));

  if (!object) {
    throw new Error(`Missing core pack object: ${sha256}`);
  }

  const unzipped = unzipSync(new Uint8Array(await object.arrayBuffer()));
  const entries = new Map();

  for (const [path, bytes] of Object.entries(unzipped)) {
    entries.set(path, bytes);
  }

  return entries;
}

function createFixedLengthZipStream(entries, expectedLength) {
  const { readable, writable } = new FixedLengthStream(expectedLength);

  createZipStream(entries)
    .pipeTo(writable)
    .catch((error) => {
      console.error("Native fixed-length ZIP stream failed", error?.message ?? error);
    });

  return readable;
}

function createZipStream(entries) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  writeZip(writer, entries).catch((error) => {
    writer.abort(error).catch(() => undefined);
  });

  return readable;
}

async function writeZip(writer, entries) {
  let offset = 0;
  const centralEntries = [];
  const openPromises = new Array(entries.length);
  let nextToPrefetch = 0;

  async function write(bytes) {
    await writer.write(bytes);
    offset += bytes.byteLength;
  }

  function prefetchThrough(exclusiveIndex) {
    while (nextToPrefetch < entries.length && nextToPrefetch < exclusiveIndex) {
      const promise = entries[nextToPrefetch].open();

      promise.catch(() => undefined);
      openPromises[nextToPrefetch] = promise;
      nextToPrefetch += 1;
    }
  }

  prefetchThrough(zipEntryOpenPrefetch);

  for (let index = 0; index < entries.length; index += 1) {
    prefetchThrough(index + zipEntryOpenPrefetch + 1);

    const entry = entries[index];

    validateZipPath(entry.path);

    const pathBytes = textEncoder.encode(entry.path);
    const { dosTime, dosDate } = toDosDateTime(entry.mtimeMs);
    const localHeaderOffset = offset;

    assertZip32Value(entry.size, "ZIP entry size");
    assertZip32Value(entry.crc32, "ZIP entry CRC32");
    assertZip32Value(localHeaderOffset, "ZIP local header offset");

    await write(localFileHeader(pathBytes, entry.crc32, entry.size, dosTime, dosDate));

    let actualSize = 0;
    const stream = await (openPromises[index] ?? entry.open());
    const reader = stream.getReader();

    try {
      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }

        const chunk = normalizeChunk(result.value);
        actualSize += chunk.byteLength;
        await write(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    if (actualSize !== entry.size) {
      throw new Error(
        `ZIP entry size mismatch for ${entry.path}: expected ${entry.size}, got ${actualSize}`,
      );
    }

    centralEntries.push({
      pathBytes,
      crc32: entry.crc32,
      size: actualSize,
      localHeaderOffset,
      dosTime,
      dosDate,
    });
  }

  const centralDirectoryOffset = offset;

  for (const entry of centralEntries) {
    await write(centralDirectoryHeader(entry));
  }

  const centralDirectorySize = offset - centralDirectoryOffset;

  assertZip16Value(centralEntries.length, "ZIP entry count");
  assertZip32Value(centralDirectoryOffset, "ZIP central directory offset");
  assertZip32Value(centralDirectorySize, "ZIP central directory size");

  await write(endOfCentralDirectory(centralEntries.length, centralDirectorySize, centralDirectoryOffset));
  await writer.close();
}

function estimateZipStreamSize(entries) {
  let offset = 0;
  let centralDirectorySize = 0;

  for (const entry of entries) {
    validateZipPath(entry.path);

    const pathBytes = textEncoder.encode(entry.path);

    assertZip16Value(pathBytes.byteLength, "ZIP path length");
    assertZip32Value(entry.size, "ZIP entry size");
    assertZip32Value(entry.crc32, "ZIP entry CRC32");
    assertZip32Value(offset, "ZIP local header offset");

    offset += 30 + pathBytes.byteLength;
    offset += entry.size;
    centralDirectorySize += 46 + pathBytes.byteLength;

    assertSafeZipSize(offset, "ZIP local data size");
    assertSafeZipSize(centralDirectorySize, "ZIP central directory size");
  }

  assertZip16Value(entries.length, "ZIP entry count");
  assertZip32Value(offset, "ZIP central directory offset");
  assertZip32Value(centralDirectorySize, "ZIP central directory size");

  const totalSize = offset + centralDirectorySize + 22;

  assertSafeZipSize(totalSize, "ZIP total size");

  return totalSize;
}

function localFileHeader(pathBytes, crc32, size, dosTime, dosDate) {
  assertZip16Value(pathBytes.byteLength, "ZIP path length");
  assertZip32Value(crc32, "ZIP entry CRC32");
  assertZip32Value(size, "ZIP entry size");

  const bytes = new Uint8Array(30 + pathBytes.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, localFileHeaderSignature, true);
  view.setUint16(4, zipVersion20, true);
  view.setUint16(6, zipFlagUtf8, true);
  view.setUint16(8, zipMethodStore, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, pathBytes.byteLength, true);
  view.setUint16(28, 0, true);
  bytes.set(pathBytes, 30);

  return bytes;
}

function centralDirectoryHeader(entry) {
  assertZip16Value(entry.pathBytes.byteLength, "ZIP path length");

  const bytes = new Uint8Array(46 + entry.pathBytes.byteLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, centralDirectorySignature, true);
  view.setUint16(4, zipVersion20, true);
  view.setUint16(6, zipVersion20, true);
  view.setUint16(8, zipFlagUtf8, true);
  view.setUint16(10, zipMethodStore, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.pathBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  bytes.set(entry.pathBytes, 46);

  return bytes;
}

function endOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, endOfCentralDirectorySignature, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return bytes;
}

function validateZipPath(path) {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid ZIP path: ${path}`);
  }
}

function toDosDateTime(mtimeMs) {
  const date = mtimeMs === null ? new Date(Date.UTC(2026, 0, 1)) : new Date(mtimeMs);
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function normalizeChunk(value) {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value;
  }

  return new Uint8Array(value);
}

function streamBytes(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function downloadHeaders(record, cacheStatus, contentLength) {
  const headers = new Headers();

  headers.set("Content-Type", "application/zip");
  headers.set("Content-Length", String(contentLength));
  headers.set("Content-Disposition", contentDisposition(downloadFileName(record)));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", `"archive-${record.id}-${record.manifestSha256}-${downloadZipBuilderVersion}"`);
  headers.set("X-Archive-Version-Id", String(record.id));
  headers.set("X-Manifest-SHA256", record.manifestSha256);
  headers.set("X-Estimated-R2-Get-Count", String(record.estimatedR2GetCount));
  headers.set("X-Download-Cache", cacheStatus);
  headers.set("X-Download-Zip-Builder", downloadZipBuilderVersion);

  return headers;
}

function downloadFileName(record) {
  return `${record.workChineseTitle || record.workOriginalTitle} ${record.releaseLabel} ${record.archiveLabel}.zip`;
}

function contentDisposition(fileName) {
  const fallback =
    fileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]+/g, "_")
      .replace(/[\\"]/g, "_")
      .trim() || "archive.zip";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function downloadCacheRequest(request, record) {
  const url = new URL(request.url);

  url.search = "";
  url.pathname = `/api/archive-versions/${record.id}/download/cache/${record.manifestSha256}/${record.packerVersion}/${downloadZipBuilderVersion}`;

  return new Request(url.toString(), { method: "GET" });
}

function downloadBuildCacheKey(request) {
  const url = new URL(request.url);

  return `${url.pathname}${url.search}`;
}

function numberHeader(value) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : null;
}

function shouldTryWorkersCache(totalSizeBytes) {
  return totalSizeBytes > 0 && totalSizeBytes <= 500 * 1024 * 1024;
}

function shouldBypassDownloadCache(request, env) {
  const url = new URL(request.url);

  return (
    url.searchParams.get("debug_download_cache") === "bypass" &&
    String(env.APP_ORIGIN ?? "").includes("staging")
  );
}

async function recordDownloadAccess(db, input) {
  const hitIncrement = input.cacheStatus === "HIT" ? 1 : 0;
  const missIncrement = input.cacheStatus === "MISS" ? 1 : 0;
  const bypassIncrement = input.cacheStatus === "BYPASS" ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO download_builds (
        archive_version_id,
        manifest_sha256,
        cache_key,
        status,
        size_bytes,
        estimated_r2_get_count,
        actual_r2_get_count,
        download_count,
        cache_hit_count,
        cache_miss_count,
        cache_bypass_count,
        total_r2_get_count,
        last_cache_status,
        last_duration_ms,
        created_at,
        last_accessed_at
      ) VALUES (?, ?, ?, 'ready', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'ready',
        size_bytes = excluded.size_bytes,
        estimated_r2_get_count = excluded.estimated_r2_get_count,
        actual_r2_get_count = COALESCE(download_builds.actual_r2_get_count, 0) + excluded.actual_r2_get_count,
        download_count = download_builds.download_count + 1,
        cache_hit_count = download_builds.cache_hit_count + excluded.cache_hit_count,
        cache_miss_count = download_builds.cache_miss_count + excluded.cache_miss_count,
        cache_bypass_count = download_builds.cache_bypass_count + excluded.cache_bypass_count,
        total_r2_get_count = download_builds.total_r2_get_count + excluded.total_r2_get_count,
        last_cache_status = excluded.last_cache_status,
        last_duration_ms = excluded.last_duration_ms,
        last_error_message = NULL,
        last_accessed_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.record.id,
      input.record.manifestSha256,
      input.cacheKey,
      input.sizeBytes,
      input.record.estimatedR2GetCount,
      input.actualR2GetCount,
      hitIncrement,
      missIncrement,
      bypassIncrement,
      input.actualR2GetCount,
      input.cacheStatus,
      input.durationMs,
    )
    .run()
    .catch((error) => {
      console.warn("Download observability write failed", error?.message ?? error);
    });
}

async function markDownloadCachePut(db, cacheKey) {
  await db
    .prepare(
      `UPDATE download_builds
      SET last_cache_put_at = CURRENT_TIMESTAMP
      WHERE cache_key = ?`,
    )
    .bind(cacheKey)
    .run()
    .catch((error) => {
      console.warn("Download cache put observability write failed", error?.message ?? error);
    });
}

async function recordDownloadFailure(db, input) {
  await db
    .prepare(
      `INSERT INTO download_builds (
        archive_version_id,
        manifest_sha256,
        cache_key,
        status,
        estimated_r2_get_count,
        download_count,
        failure_count,
        last_duration_ms,
        last_error_message,
        created_at,
        last_accessed_at
      ) VALUES (?, ?, ?, 'failed', ?, 0, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'failed',
        estimated_r2_get_count = excluded.estimated_r2_get_count,
        failure_count = download_builds.failure_count + 1,
        last_duration_ms = excluded.last_duration_ms,
        last_error_message = excluded.last_error_message,
        last_accessed_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.record.id,
      input.record.manifestSha256,
      input.cacheKey,
      input.record.estimatedR2GetCount,
      Math.max(0, input.durationMs),
      String(input.errorMessage ?? "Unknown error").slice(0, 1000),
    )
    .run()
    .catch((error) => {
      console.warn("Download failure observability write failed", error?.message ?? error);
    });
}

function withDownloadCacheHeader(response, cacheStatus) {
  const headers = new Headers(response.headers);

  headers.set("X-Download-Cache", cacheStatus);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function blobKey(sha256) {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

function corePackKey(sha256) {
  return `core-packs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.zip`;
}

function manifestKey(sha256) {
  return `manifests/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.json`;
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertZip16Value(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > uint16Max) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function assertZip32Value(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > uint32Max) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function assertSafeZipSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a safe integer`);
  }
}
