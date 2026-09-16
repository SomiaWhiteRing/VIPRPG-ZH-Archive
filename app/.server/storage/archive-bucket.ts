import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  blobKey,
  corePackKey,
  manifestKey,
} from "@/app/.server/storage/archive-keys";

export function getArchiveBucket(runtime: AppRuntime): R2Bucket {
  return getCloudflareEnv(runtime).ARCHIVE_BUCKET;
}

export async function getBlob(
  runtime: AppRuntime,
  sha256: string,
): Promise<R2ObjectBody | null> {
  return getArchiveBucket(runtime).get(blobKey(sha256));
}

export async function putBlob(
  runtime: AppRuntime,
  sha256: string,
  body: ReadableStream | ArrayBuffer | string,
  sizeBytes: number,
  contentTypeHint = "application/octet-stream",
): Promise<R2Object> {
  return getArchiveBucket(runtime).put(blobKey(sha256), body, {
    httpMetadata: {
      contentType: contentTypeHint,
    },
    customMetadata: {
      sha256,
      sizeBytes: String(sizeBytes),
    },
  });
}

export async function getCorePack(
  runtime: AppRuntime,
  sha256: string,
): Promise<R2ObjectBody | null> {
  return getArchiveBucket(runtime).get(corePackKey(sha256));
}

export async function putCorePack(
  runtime: AppRuntime,
  sha256: string,
  body: ReadableStream | ArrayBuffer | string,
  sizeBytes: number,
): Promise<R2Object> {
  return getArchiveBucket(runtime).put(corePackKey(sha256), body, {
    httpMetadata: {
      contentType: "application/zip",
    },
    customMetadata: {
      sha256,
      sizeBytes: String(sizeBytes),
    },
  });
}

export async function putManifest(
  runtime: AppRuntime,
  manifestSha256: string,
  manifestJson: string,
  metadata: {
    workId?: number;
    archiveVersionId?: number;
  } = {},
): Promise<R2Object> {
  return getArchiveBucket(runtime).put(
    manifestKey(manifestSha256),
    manifestJson,
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
      customMetadata: {
        manifestSha256,
        ...(metadata.workId === undefined
          ? {}
          : { workId: String(metadata.workId) }),
        ...(metadata.archiveVersionId === undefined
          ? {}
          : { archiveVersionId: String(metadata.archiveVersionId) }),
      },
    },
  );
}
