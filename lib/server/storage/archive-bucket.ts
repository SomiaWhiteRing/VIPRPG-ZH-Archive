import { getCloudflareEnv } from "@/lib/server/cloudflare/env";
import { blobKey, corePackKey, manifestKey } from "@/lib/server/storage/archive-keys";

export function getArchiveBucket(): R2Bucket {
  return getCloudflareEnv().ARCHIVE_BUCKET;
}

export async function getBlob(sha256: string): Promise<R2ObjectBody | null> {
  return getArchiveBucket().get(blobKey(sha256));
}

export async function putBlob(
  sha256: string,
  body: ReadableStream | ArrayBuffer | string,
  sizeBytes: number,
  contentTypeHint = "application/octet-stream",
): Promise<R2Object> {
  return getArchiveBucket().put(blobKey(sha256), body, {
    httpMetadata: {
      contentType: contentTypeHint,
    },
    customMetadata: {
      sha256,
      sizeBytes: String(sizeBytes),
    },
  });
}

export async function getCorePack(sha256: string): Promise<R2ObjectBody | null> {
  return getArchiveBucket().get(corePackKey(sha256));
}

export async function putCorePack(
  sha256: string,
  body: ReadableStream | ArrayBuffer | string,
  sizeBytes: number,
): Promise<R2Object> {
  return getArchiveBucket().put(corePackKey(sha256), body, {
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
  manifestSha256: string,
  manifestJson: string,
  metadata: {
    workId?: number;
    releaseId?: number;
    archiveVersionId?: number;
  } = {},
): Promise<R2Object> {
  return getArchiveBucket().put(
    manifestKey(manifestSha256),
    manifestJson,
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
      customMetadata: {
        manifestSha256,
        ...(metadata.workId === undefined ? {} : { workId: String(metadata.workId) }),
        ...(metadata.releaseId === undefined ? {} : { releaseId: String(metadata.releaseId) }),
        ...(metadata.archiveVersionId === undefined
          ? {}
          : { archiveVersionId: String(metadata.archiveVersionId) }),
      },
    },
  );
}
