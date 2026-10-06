import { getCloudflareEnv } from "@/app/.server/cloudflare/env";
import type { AppRuntime } from "@/app/.server/runtime";
import { parseEasyRpgConfig, type EasyRpgConfig } from "@/lib/archive/easyrpg-config";
import { sha256Hex } from "@/lib/sha256";
import {
  blobKey,
  corePackKey,
  manifestKey,
} from "@/lib/archive/object-keys";

export function getArchiveBucket(runtime: AppRuntime): R2Bucket {
  return getCloudflareEnv(runtime).ARCHIVE_BUCKET;
}

export async function readArchiveEasyRpgConfig(runtime: AppRuntime, manifestSha256: string): Promise<EasyRpgConfig | undefined> {
  const object = await getArchiveBucket(runtime).get(manifestKey(manifestSha256));
  if (!object) throw new Error(`Missing manifest object: ${manifestSha256}`);
  const text = await object.text();
  if (await sha256Hex(new TextEncoder().encode(text).buffer) !== manifestSha256) throw new Error("Manifest SHA-256 mismatch");
  const manifest = JSON.parse(text);
  if (manifest?.schema !== "viprpg-archive.manifest.v1" || !manifest.archiveVersion) throw new Error("Invalid archive manifest");
  return manifest.archiveVersion.easyRpg === undefined ? undefined : parseEasyRpgConfig(manifest.archiveVersion.easyRpg);
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
