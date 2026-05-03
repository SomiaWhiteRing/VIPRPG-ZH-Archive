import { getCloudflareContext } from "@opennextjs/cloudflare";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import type { ArchiveManifest } from "@/lib/archive/manifest";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import {
  getPublishedArchiveDownloadRecord,
  parseArchiveVersionId,
} from "@/lib/server/db/archive-downloads";
import {
  cacheKeyFromRequest,
  markDownloadCachePut,
  recordDownloadAccess,
  recordDownloadFailure,
} from "@/lib/server/db/download-builds";
import {
  createFixedLengthArchiveZipStream,
  estimateArchiveZipSize,
} from "@/lib/server/download/archive-zip";
import { json, jsonError } from "@/lib/server/http/json";
import { getManifest } from "@/lib/server/storage/archive-bucket";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

type CloudflareCacheStorage = CacheStorage & {
  default: Cache;
};

type DownloadRecord = NonNullable<
  Awaited<ReturnType<typeof getPublishedArchiveDownloadRecord>>
>;

export async function GET(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  let failureRecord: DownloadRecord | null = null;
  let failureCacheKey: string | null = null;

  try {
    const record = await getDownloadRecord(context);

    if (!record) {
      return json(
        {
          ok: false,
          error: "Archive version not found",
        },
        { status: 404 },
      );
    }

    failureRecord = record;
    const cacheRequest = downloadCacheRequest(request, record);
    const cacheKey = cacheKeyFromRequest(cacheRequest);
    failureCacheKey = cacheKey;
    const bypassDownloadCache = shouldBypassDownloadCache(request);
    const cached = bypassDownloadCache ? null : await matchDownloadCache(cacheRequest);

    if (cached) {
      queueRecordDownloadAccess({
        archiveVersionId: record.id,
        manifestSha256: record.manifestSha256,
        cacheKey,
        cacheStatus: "HIT",
        sizeBytes: numberHeader(cached.headers.get("Content-Length")) ?? record.totalSizeBytes,
        estimatedR2GetCount: record.estimatedR2GetCount,
        actualR2GetCount: 0,
        durationMs: Date.now() - startedAt,
      });

      return withCacheHeader(cached, "HIT");
    }

    const manifest = await loadManifest(record.manifestSha256);
    const zipSizeBytes = estimateArchiveZipSize(manifest);
    const cacheStatus = bypassDownloadCache ? "BYPASS" : "MISS";
    const response = new Response(
      createFixedLengthArchiveZipStream(manifest, zipSizeBytes),
      {
        headers: downloadHeaders(record, cacheStatus, zipSizeBytes),
      },
    );

    if (!bypassDownloadCache) {
      putDownloadCache(
        cacheRequest,
        withCacheHeader(response.clone(), "HIT"),
        record.totalSizeBytes,
        cacheKey,
      );
    }

    queueRecordDownloadAccess({
      archiveVersionId: record.id,
      manifestSha256: record.manifestSha256,
      cacheKey,
      cacheStatus,
      sizeBytes: zipSizeBytes,
      estimatedR2GetCount: record.estimatedR2GetCount,
      actualR2GetCount: record.estimatedR2GetCount,
      durationMs: Date.now() - startedAt,
    });

    return response;
  } catch (error) {
    if (failureRecord && failureCacheKey) {
      queueRecordDownloadFailure({
        archiveVersionId: failureRecord.id,
        manifestSha256: failureRecord.manifestSha256,
        cacheKey: failureCacheKey,
        estimatedR2GetCount: failureRecord.estimatedR2GetCount,
        durationMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return jsonError("Archive download failed", error);
  }
}

export async function HEAD(_request: Request, context: RouteContext) {
  try {
    const record = await getDownloadRecord(context);

    if (!record) {
      return new Response(null, { status: 404 });
    }

    const manifest = await loadManifest(record.manifestSha256);
    const zipSizeBytes = estimateArchiveZipSize(manifest);

    return new Response(null, {
      headers: downloadHeaders(record, "BYPASS", zipSizeBytes),
    });
  } catch (error) {
    console.error(
      "Archive download HEAD failed",
      error instanceof Error ? error.message : error,
    );

    return new Response(null, { status: 500 });
  }
}

async function getDownloadRecord(context: RouteContext): Promise<DownloadRecord | null> {
  const { archiveVersionId: rawArchiveVersionId } = await context.params;
  const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);

  return getPublishedArchiveDownloadRecord(archiveVersionId);
}

async function loadManifest(manifestSha256: string): Promise<ArchiveManifest> {
  const object = await getManifest(manifestSha256);

  if (!object) {
    throw new Error(`Missing manifest object: ${manifestSha256}`);
  }

  const jsonText = await object.text();
  const actualSha256 = await sha256Hex(new TextEncoder().encode(jsonText).buffer);

  if (actualSha256 !== manifestSha256) {
    throw new Error(`Manifest SHA-256 mismatch: ${manifestSha256}`);
  }

  const manifest = JSON.parse(jsonText) as ArchiveManifest;

  if (manifest.schema !== "viprpg-archive.manifest.v1") {
    throw new Error(`Unsupported manifest schema: ${manifest.schema}`);
  }

  return manifest;
}

function downloadHeaders(
  record: DownloadRecord,
  cacheStatus: "HIT" | "MISS" | "BYPASS",
  contentLength: number,
): Headers {
  const headers = new Headers();

  headers.set("Content-Type", "application/zip");
  headers.set("Content-Length", String(contentLength));
  headers.set("Content-Disposition", contentDisposition(downloadFileName(record)));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set(
    "ETag",
    `"archive-${record.id}-${record.manifestSha256}-${downloadZipBuilderVersion}"`,
  );
  headers.set("X-Archive-Version-Id", String(record.id));
  headers.set("X-Manifest-SHA256", record.manifestSha256);
  headers.set("X-Estimated-R2-Get-Count", String(record.estimatedR2GetCount));
  headers.set("X-Download-Cache", cacheStatus);
  headers.set("X-Download-Zip-Builder", downloadZipBuilderVersion);

  return headers;
}

function downloadFileName(record: DownloadRecord): string {
  return `${record.workChineseTitle || record.workOriginalTitle} ${record.releaseLabel} ${record.archiveLabel}.zip`;
}

function contentDisposition(fileName: string): string {
  const fallback = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/[\\"]/g, "_")
    .trim() || "archive.zip";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function downloadCacheRequest(
  request: Request,
  record: DownloadRecord,
): Request {
  const url = new URL(request.url);

  url.search = "";
  url.pathname = `/api/archive-versions/${record.id}/download/cache/${record.manifestSha256}/${record.packerVersion}/${downloadZipBuilderVersion}`;

  return new Request(url.toString(), { method: "GET" });
}

async function matchDownloadCache(request: Request): Promise<Response | null> {
  const cache = getDefaultWorkersCache();

  if (!cache) {
    return null;
  }

  return (await cache.match(request)) ?? null;
}

function putDownloadCache(
  request: Request,
  response: Response,
  totalSizeBytes: number,
  cacheKey: string,
): void {
  const cache = getDefaultWorkersCache();

  if (!cache || !shouldTryWorkersCache(totalSizeBytes)) {
    return;
  }

  const { ctx } = getCloudflareContext();

  ctx.waitUntil(
    cache
      .put(request, response)
      .then(() => markDownloadCachePut(cacheKey))
      .catch((error: unknown) => {
        console.warn(
          "Download cache put failed",
          error instanceof Error ? error.message : error,
        );
      }),
  );
}

function getDefaultWorkersCache(): Cache | null {
  if (typeof caches === "undefined") {
    return null;
  }

  return (caches as CloudflareCacheStorage).default ?? null;
}

function queueRecordDownloadAccess(
  input: Parameters<typeof recordDownloadAccess>[0],
): void {
  const { ctx } = getCloudflareContext();

  ctx.waitUntil(
    recordDownloadAccess(input).catch((error: unknown) => {
      console.warn(
        "Download observability write failed",
        error instanceof Error ? error.message : error,
      );
    }),
  );
}

function queueRecordDownloadFailure(
  input: Parameters<typeof recordDownloadFailure>[0],
): void {
  const { ctx } = getCloudflareContext();

  ctx.waitUntil(
    recordDownloadFailure(input).catch((error: unknown) => {
      console.warn(
        "Download failure observability write failed",
        error instanceof Error ? error.message : error,
      );
    }),
  );
}

function shouldTryWorkersCache(totalSizeBytes: number): boolean {
  return totalSizeBytes > 0 && totalSizeBytes <= 500 * 1024 * 1024;
}

function shouldBypassDownloadCache(request: Request): boolean {
  const url = new URL(request.url);

  return (
    url.searchParams.get("debug_download_cache") === "bypass" &&
    String(getCloudflareContext().env.APP_ORIGIN ?? "").includes("staging")
  );
}

function numberHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : null;
}

function withCacheHeader(response: Response, cacheStatus: "HIT"): Response {
  const headers = new Headers(response.headers);

  headers.set("X-Download-Cache", cacheStatus);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
