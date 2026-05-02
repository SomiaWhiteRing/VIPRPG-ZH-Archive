/// <reference lib="webworker" />

import { unzipSync, zipSync } from "fflate";
import {
  classifyArchivePath,
  contentTypeForArchivePath,
  FILE_POLICY_VERSION,
  normalizeArchivePath,
  PACKER_VERSION,
} from "@/lib/archive/file-policy";
import type {
  ArchiveCommitMetadata,
  ArchiveManifest,
  ArchiveManifestFile,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import { saveTaskError, saveTaskSnapshot } from "@/app/upload/upload-task-db";
import type {
  BrowserUploadTaskSnapshot,
  UploadSourceKind,
  UploadTaskCommitResult,
  UploadTaskPhase,
  UploadTaskStats,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";

type SourceFile = {
  path: string;
  size: number;
  mtimeMs: number | null;
  contentType: string;
  bytes: () => Promise<Uint8Array>;
};

type IncludedFile = {
  path: string;
  pathSortKey: string;
  role: ArchiveManifestFile["role"];
  storageKind: "blob" | "core_pack";
  sha256: string;
  size: number;
  mtimeMs: number | null;
  contentType: string;
  packEntryPath: string | null;
  source: SourceFile;
};

type BlobObject = {
  sha256: string;
  size: number;
  contentType: string;
  source: SourceFile;
  uploaded: boolean;
};

type CorePackObject = {
  sha256: string;
  bytes: Uint8Array;
  uncompressedSize: number;
  fileCount: number;
};

const stageWeights: Record<UploadTaskPhase, { base: number; weight: number }> = {
  created: { base: 0, weight: 0 },
  source_selected: { base: 0, weight: 0 },
  enumerating: { base: 0, weight: 5 },
  hashing: { base: 5, weight: 30 },
  building_core_pack: { base: 35, weight: 15 },
  manifest_ready: { base: 50, weight: 0 },
  creating_import_job: { base: 50, weight: 5 },
  preflighting: { base: 55, weight: 5 },
  uploading_missing_objects: { base: 60, weight: 30 },
  verifying_objects: { base: 90, weight: 0 },
  committing: { base: 90, weight: 10 },
  completed: { base: 100, weight: 0 },
};

const pausedTasks = new Set<string>();
const canceledTasks = new Set<string>();
const lastEmitAt = new Map<string, number>();

self.onmessage = (event: MessageEvent<UploadWorkerInput>) => {
  const message = event.data;

  if (message.type === "start") {
    runUpload(message).catch((error: unknown) => {
      postLog(
        message.resumeLocalTaskId ?? message.localTaskId,
        error instanceof Error ? error.message : "上传任务失败",
      );
    });
    return;
  }

  if (message.type === "pause") {
    pausedTasks.add(message.localTaskId);
    return;
  }

  if (message.type === "resume") {
    pausedTasks.delete(message.localTaskId);
    return;
  }

  if (message.type === "cancel") {
    canceledTasks.add(message.localTaskId);
  }
};

async function runUpload(message: Extract<UploadWorkerInput, { type: "start" }>) {
  const localTaskId = message.resumeLocalTaskId ?? message.localTaskId;
  const now = new Date().toISOString();
  let task = createInitialTask({
    localTaskId,
    sourceKind: message.sourceKind,
    sourceName: inferSourceName(message.files, message.sourceKind),
    metadata: message.metadata,
    now,
  });

  canceledTasks.delete(localTaskId);
  pausedTasks.delete(localTaskId);
  task = await persistAndPost(task, true);

  try {
    task = setPhase(task, "enumerating", 1, null);
    task = await persistAndPost(task, true);
    const sourceFiles = await enumerateSourceFiles(message.files, message.sourceKind);
    const sourceFingerprint = await fingerprintSource(sourceFiles, message.sourceKind);
    const sourceSize = sourceFiles.reduce((sum, file) => sum + file.size, 0);

    task = {
      ...task,
      sourceName: inferCleanSourceName(message.files, message.sourceKind),
      sourceFingerprint,
      stats: {
        ...task.stats,
        sourceFileCount: sourceFiles.length,
        sourceSizeBytes: sourceSize,
      },
      progress: {
        ...task.progress,
        totalBytes: sourceSize,
        totalFiles: sourceFiles.length,
      },
    };
    task = setPhase(task, "hashing", 0, null);
    task = await persistAndPost(task, true);

    const scan = await scanAndHash(task, sourceFiles);
    task = scan.task;

    const corePack = await buildCorePack(task, scan.coreFiles);
    task = corePack.task;

    const manifestResult = await buildManifest({
      task,
      includedFiles: scan.includedFiles,
      blobObjects: scan.blobObjects,
      corePack: corePack.corePack,
      sourceKind: message.sourceKind,
    });
    task = {
      ...task,
      phase: "manifest_ready",
      manifestSha256: manifestResult.manifestSha256,
      manifestJson: manifestResult.manifestJson,
      corePackSha256: manifestResult.corePack.sha256,
      stats: {
        ...task.stats,
        corePackFileCount: manifestResult.corePack.fileCount,
        corePackRawSizeBytes: manifestResult.corePack.uncompressedSize,
        corePackZipSizeBytes: manifestResult.corePack.bytes.byteLength,
        estimatedR2GetCount: scan.blobObjects.size + 1,
      },
      progress: {
        ...task.progress,
        percent: 50,
      },
    };
    task = await persistAndPost(task, true);

    task = await createImportJob(task);
    const preflight = await preflightObjects(
      task,
      [...scan.blobObjects.values()].map((blob) => ({
        sha256: blob.sha256,
        sizeBytes: blob.size,
      })),
      [
        {
          sha256: manifestResult.corePack.sha256,
          sizeBytes: manifestResult.corePack.bytes.byteLength,
        },
      ],
    );
    task = preflight.task;

    task = await uploadMissingObjects({
      task,
      blobObjects: scan.blobObjects,
      corePack: manifestResult.corePack,
      missingBlobs: preflight.missingBlobs,
      missingCorePacks: preflight.missingCorePacks,
    });

    task = setPhase(task, "committing", 0, null);
    task = await persistAndPost(task, true);
    const result = await commitTask(task, message.metadata, task.stats.excludedFileTypes);
    task = {
      ...task,
      status: "completed",
      phase: "completed",
      completedAt: new Date().toISOString(),
      result,
      progress: {
        ...task.progress,
        percent: 100,
      },
    };
    await persistAndPost(task, true);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "上传任务失败";
    const failedTask: BrowserUploadTaskSnapshot = {
      ...task,
      status: canceledTasks.has(localTaskId) ? "canceled" : "failed_recoverable",
      updatedAt: new Date().toISOString(),
      error: messageText,
    };

    await saveTaskError({
      localTaskId,
      phase: failedTask.phase,
      message: messageText,
    });
    await persistAndPost(failedTask, true);

    if (failedTask.serverImportJobId) {
      await fetch(`/api/imports/${failedTask.serverImportJobId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => undefined);
    }
  }
}

async function enumerateSourceFiles(
  files: File[],
  sourceKind: UploadSourceKind,
): Promise<SourceFile[]> {
  if (sourceKind === "zip") {
    const zipFile = files[0];

    if (!zipFile) {
      throw new Error("未选择 ZIP 文件");
    }

    const entries = unzipSync(new Uint8Array(await zipFile.arrayBuffer()));
    const paths = stripCommonRoot(
      Object.keys(entries)
        .filter((path) => !path.endsWith("/"))
        .map(normalizeArchivePath),
    );

    return Object.entries(entries)
      .filter(([path]) => !path.endsWith("/"))
      .map(([path, bytes]) => {
        const normalized = normalizeArchivePath(path);
        return {
          path: paths.get(normalized) ?? normalized,
          size: bytes.byteLength,
          mtimeMs: null,
          contentType: contentTypeForArchivePath(normalized),
          bytes: async () => bytes,
        };
      })
      .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  }

  const rawPaths = files.map((file) => rawRelativePath(file));
  const stripped = stripCommonRoot(rawPaths);

  return files
    .map((file) => {
      const rawPath = rawRelativePath(file);
      const path = stripped.get(rawPath) ?? rawPath;

      return {
        path,
        size: file.size,
        mtimeMs: Number.isFinite(file.lastModified) ? file.lastModified : null,
        contentType: file.type || contentTypeForArchivePath(path),
        bytes: async () => new Uint8Array(await file.arrayBuffer()),
      };
    })
    .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
}

async function scanAndHash(
  initialTask: BrowserUploadTaskSnapshot,
  sourceFiles: SourceFile[],
): Promise<{
  task: BrowserUploadTaskSnapshot;
  includedFiles: IncludedFile[];
  coreFiles: IncludedFile[];
  blobObjects: Map<string, BlobObject>;
}> {
  let task = initialTask;
  const includedFiles: IncludedFile[] = [];
  const coreFiles: IncludedFile[] = [];
  const blobObjects = new Map<string, BlobObject>();
  const excluded = new Map<string, ExcludedFileTypeSummary>();
  let processedBytes = 0;
  let processedFiles = 0;
  let includedSize = 0;
  let excludedSize = 0;

  for (const source of sourceFiles) {
    await waitIfPaused(task.localTaskId);
    assertNotCanceled(task.localTaskId);

    const classification = classifyArchivePath(source.path);
    processedFiles += 1;

    if (!classification.included) {
      processedBytes += source.size;
      excludedSize += source.size;
      addExcluded(excluded, classification.fileType, source);
      task = updateHashProgress(task, {
        processedBytes,
        processedFiles,
        currentPath: source.path,
        includedFileCount: includedFiles.length,
        includedSizeBytes: includedSize,
        excludedFileCount: processedFiles - includedFiles.length,
        excludedSizeBytes: excludedSize,
        excludedFileTypes: [...excluded.values()],
      });
      await persistAndPost(task);
      continue;
    }

    const bytes = await source.bytes();
    const sha256 = await sha256Bytes(bytes);
    const included: IncludedFile = {
      path: source.path,
      pathSortKey: source.path.toLowerCase(),
      role: classification.role,
      storageKind: classification.storageKind,
      sha256,
      size: source.size,
      mtimeMs: source.mtimeMs,
      contentType: source.contentType,
      packEntryPath: classification.packEntryPath,
      source,
    };

    includedFiles.push(included);
    includedSize += source.size;

    if (included.storageKind === "core_pack") {
      coreFiles.push(included);
    } else if (!blobObjects.has(sha256)) {
      blobObjects.set(sha256, {
        sha256,
        size: source.size,
        contentType: source.contentType,
        source,
        uploaded: false,
      });
    }

    processedBytes += source.size;
    task = updateHashProgress(task, {
      processedBytes,
      processedFiles,
      currentPath: source.path,
      includedFileCount: includedFiles.length,
      includedSizeBytes: includedSize,
      excludedFileCount: processedFiles - includedFiles.length,
      excludedSizeBytes: excludedSize,
      excludedFileTypes: [...excluded.values()],
    });
    await persistAndPost(task);
  }

  const uniqueBlobSize = [...blobObjects.values()].reduce(
    (sum, item) => sum + item.size,
    0,
  );

  task = {
    ...task,
    stats: {
      ...task.stats,
      includedFileCount: includedFiles.length,
      includedSizeBytes: includedSize,
      excludedFileCount: sourceFiles.length - includedFiles.length,
      excludedSizeBytes: excludedSize,
      uniqueBlobCount: blobObjects.size,
      uniqueBlobSizeBytes: uniqueBlobSize,
      excludedFileTypes: [...excluded.values()].sort(
        (a, b) => b.totalSizeBytes - a.totalSizeBytes || a.fileType.localeCompare(b.fileType),
      ),
    },
  };

  return {
    task,
    includedFiles,
    coreFiles,
    blobObjects,
  };
}

async function buildCorePack(
  initialTask: BrowserUploadTaskSnapshot,
  coreFiles: IncludedFile[],
): Promise<{ task: BrowserUploadTaskSnapshot; corePack: CorePackObject }> {
  let task = setPhase(initialTask, "building_core_pack", 0, null);
  task = await persistAndPost(task, true);
  const zipEntries: Record<string, Uint8Array> = {};
  let rawSize = 0;
  let processed = 0;

  for (const file of coreFiles) {
    await waitIfPaused(task.localTaskId);
    assertNotCanceled(task.localTaskId);
    zipEntries[file.packEntryPath ?? file.path] = await file.source.bytes();
    rawSize += file.size;
    processed += 1;
    task = setPhase(task, "building_core_pack", processed / Math.max(coreFiles.length, 1), file.path);
    task = await persistAndPost(task);
  }

  const bytes = zipSync(zipEntries, { level: 1 });
  const sha256 = await sha256Bytes(bytes);

  return {
    task,
    corePack: {
      sha256,
      bytes,
      uncompressedSize: rawSize,
      fileCount: coreFiles.length,
    },
  };
}

async function buildManifest(input: {
  task: BrowserUploadTaskSnapshot;
  includedFiles: IncludedFile[];
  blobObjects: Map<string, BlobObject>;
  corePack: CorePackObject;
  sourceKind: UploadSourceKind;
}): Promise<{
  manifest: ArchiveManifest;
  manifestJson: string;
  manifestSha256: string;
  corePack: CorePackObject;
}> {
  const files: ArchiveManifestFile[] = input.includedFiles
    .slice()
    .sort((a, b) => a.pathSortKey.localeCompare(b.pathSortKey))
    .map((file) => ({
      path: file.path,
      pathSortKey: file.pathSortKey,
      role: file.role,
      sha256: file.sha256,
      size: file.size,
      mtimeMs: file.mtimeMs,
      storage:
        file.storageKind === "blob"
          ? {
              kind: "blob",
              blobSha256: file.sha256,
            }
          : {
              kind: "core_pack",
              packId: "core-main",
              entry: file.packEntryPath ?? file.path,
            },
    }));
  const manifest: ArchiveManifest = {
    schema: "viprpg-archive.manifest.v1",
    work: {
      slug: input.task.metadata.work.slug,
      originalTitle: input.task.metadata.work.originalTitle,
      chineseTitle: input.task.metadata.work.chineseTitle,
    },
    release: {
      key: input.task.metadata.release.key,
      label: input.task.metadata.release.label,
      baseVariant: input.task.metadata.release.baseVariant,
      variantLabel: input.task.metadata.release.variantLabel,
      type: input.task.metadata.release.type,
    },
    archiveVersion: {
      key: input.task.metadata.archiveVersion.key,
      label: input.task.metadata.archiveVersion.label,
      variantLabel: input.task.metadata.archiveVersion.variantLabel,
      language: input.task.metadata.archiveVersion.language,
      isProofread: input.task.metadata.archiveVersion.isProofread,
      isImageEdited: input.task.metadata.archiveVersion.isImageEdited,
      createdAt: new Date().toISOString(),
      filePolicyVersion: FILE_POLICY_VERSION,
      packerVersion: PACKER_VERSION,
      sourceType: input.sourceKind === "zip" ? "browser_zip" : "browser_folder",
      sourceName: input.task.sourceName,
      sourceFileCount: input.task.stats.sourceFileCount,
      sourceSize: input.task.stats.sourceSizeBytes,
      includedFileCount: input.task.stats.includedFileCount,
      includedSize: input.task.stats.includedSizeBytes,
      excludedFileCount: input.task.stats.excludedFileCount,
      excludedSize: input.task.stats.excludedSizeBytes,
    },
    corePacks: [
      {
        id: "core-main",
        sha256: input.corePack.sha256,
        size: input.corePack.bytes.byteLength,
        uncompressedSize: input.corePack.uncompressedSize,
        fileCount: input.corePack.fileCount,
        format: "zip",
        compression: "deflate-low",
      },
    ],
    files,
  };
  const manifestJson = JSON.stringify(manifest);

  return {
    manifest,
    manifestJson,
    manifestSha256: await sha256Text(manifestJson),
    corePack: input.corePack,
  };
}

async function createImportJob(
  initialTask: BrowserUploadTaskSnapshot,
): Promise<BrowserUploadTaskSnapshot> {
  let task = setPhase(initialTask, "creating_import_job", 0, null);
  task = await persistAndPost(task, true);
  const response = await jsonFetch<{
    ok: true;
    importJob: { id: number };
  }>("/api/imports", {
    method: "POST",
    body: JSON.stringify({
      sourceName: task.sourceName,
      sourceSizeBytes: task.stats.sourceSizeBytes,
      fileCount: task.stats.includedFileCount,
      excludedFileCount: task.stats.excludedFileCount,
      excludedSizeBytes: task.stats.excludedSizeBytes,
      filePolicyVersion: FILE_POLICY_VERSION,
    }),
  });

  return {
    ...task,
    serverImportJobId: response.importJob.id,
    progress: {
      ...task.progress,
      percent: 55,
    },
  };
}

async function preflightObjects(
  initialTask: BrowserUploadTaskSnapshot,
  blobs: Array<{
    sha256: string;
    sizeBytes: number;
  }>,
  corePacks: Array<{
    sha256: string;
    sizeBytes: number;
  }>,
): Promise<{
  task: BrowserUploadTaskSnapshot;
  missingBlobs: Set<string>;
  missingCorePacks: Set<string>;
}> {
  let task = setPhase(initialTask, "preflighting", 0, null);
  task = await persistAndPost(task, true);

  if (!task.serverImportJobId) {
    throw new Error("Import job missing before preflight");
  }

  const response = await jsonFetch<{
    ok: true;
    blobs: { missing: string[]; missingCount: number; missingSizeBytes: number };
    corePacks: { missing: string[]; missingCount: number; missingSizeBytes: number };
  }>(`/api/imports/${task.serverImportJobId}/preflight`, {
    method: "POST",
    body: JSON.stringify({
      blobs,
      corePacks,
    }),
  });
  const missingBlobs = new Set(response.blobs.missing);
  const missingCorePacks = new Set(response.corePacks.missing);
  const uploadBytesTotal =
    task.stats.uniqueBlobSizeBytes + task.stats.corePackZipSizeBytes;

  task = {
    ...task,
    progress: {
      ...task.progress,
      percent: 60,
      uploadBytesTotal,
      totalUploadObjects: missingBlobs.size + missingCorePacks.size,
    },
  };
  task = await persistAndPost(task, true);

  return {
    task,
    missingBlobs,
    missingCorePacks,
  };
}

async function uploadMissingObjects(input: {
  task: BrowserUploadTaskSnapshot;
  blobObjects: Map<string, BlobObject>;
  corePack: CorePackObject;
  missingBlobs: Set<string>;
  missingCorePacks: Set<string>;
}): Promise<BrowserUploadTaskSnapshot> {
  let task = setPhase(input.task, "uploading_missing_objects", 0, null);
  let uploadedObjects = 0;
  let uploadedBytes = 0;
  const totalObjects = input.missingBlobs.size + input.missingCorePacks.size;
  const totalBytes =
    [...input.missingBlobs].reduce(
      (sum, sha256) => sum + (input.blobObjects.get(sha256)?.size ?? 0),
      0,
    ) +
    (input.missingCorePacks.has(input.corePack.sha256)
      ? input.corePack.bytes.byteLength
      : 0);

  task = {
    ...task,
    progress: {
      ...task.progress,
      totalUploadObjects: totalObjects,
      uploadBytesTotal: totalBytes,
    },
  };
  task = await persistAndPost(task, true);

  if (input.missingCorePacks.has(input.corePack.sha256)) {
    await waitIfPaused(task.localTaskId);
    assertNotCanceled(task.localTaskId);
    await uploadCorePack(input.corePack, task.serverImportJobId);
    uploadedObjects += 1;
    uploadedBytes += input.corePack.bytes.byteLength;
    task = updateUploadProgress(task, uploadedObjects, totalObjects, uploadedBytes, totalBytes, "core pack");
    task = await persistAndPost(task, true);
  }

  const missingBlobObjects = [...input.missingBlobs]
    .map((sha256) => input.blobObjects.get(sha256))
    .filter((item): item is BlobObject => Boolean(item))
    .sort((a, b) => b.size - a.size);

  await runWithConcurrency(missingBlobObjects, 4, async (blob) => {
    await waitIfPaused(task.localTaskId);
    assertNotCanceled(task.localTaskId);
    await uploadBlob(blob, task.serverImportJobId);
    blob.uploaded = true;
    uploadedObjects += 1;
    uploadedBytes += blob.size;
    task = updateUploadProgress(
      task,
      uploadedObjects,
      totalObjects,
      uploadedBytes,
      totalBytes,
      blob.source.path,
    );
    await persistAndPost(task);
  });

  task = setPhase(task, "verifying_objects", 1, null);
  return persistAndPost(task, true);
}

async function commitTask(
  task: BrowserUploadTaskSnapshot,
  metadata: ArchiveCommitMetadata,
  excludedFileTypes: ExcludedFileTypeSummary[],
): Promise<UploadTaskCommitResult> {
  if (!task.serverImportJobId || !task.manifestSha256 || !task.manifestJson) {
    throw new Error("Task is not ready for commit");
  }

  const response = await jsonFetch<{
    ok: true;
    result: UploadTaskCommitResult;
  }>(`/api/imports/${task.serverImportJobId}/commit`, {
    method: "POST",
    body: JSON.stringify({
      localTaskId: task.localTaskId,
      manifestSha256: task.manifestSha256,
      manifestJson: task.manifestJson,
      metadata,
      excludedFileTypes,
    }),
  });

  return response.result;
}

async function uploadCorePack(
  corePack: CorePackObject,
  importJobId: number | null,
): Promise<void> {
  await retry(async () => {
    const response = await fetch(uploadObjectUrl(`/api/core-packs/${corePack.sha256}`, importJobId), {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "content-type": "application/zip",
        "x-core-pack-file-count": String(corePack.fileCount),
        "x-core-pack-uncompressed-size": String(corePack.uncompressedSize),
      },
      body: toArrayBuffer(corePack.bytes),
    });

    if (!response.ok) {
      throw new Error(`Core pack upload failed: ${response.status}`);
    }
  });
}

async function uploadBlob(blob: BlobObject, importJobId: number | null): Promise<void> {
  await retry(async () => {
    const bytes = await blob.source.bytes();
    const response = await fetch(uploadObjectUrl(`/api/blobs/${blob.sha256}`, importJobId), {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "content-type": blob.contentType,
      },
      body: toArrayBuffer(bytes),
    });

    if (!response.ok) {
      throw new Error(`Blob upload failed: ${response.status} ${blob.source.path}`);
    }
  });
}

function uploadObjectUrl(path: string, importJobId: number | null): string {
  if (!importJobId) {
    return path;
  }

  return `${path}?import_job_id=${encodeURIComponent(String(importJobId))}`;
}

function createInitialTask(input: {
  localTaskId: string;
  sourceKind: UploadSourceKind;
  sourceName: string;
  metadata: ArchiveCommitMetadata;
  now: string;
}): BrowserUploadTaskSnapshot {
  return {
    localTaskId: input.localTaskId,
    serverImportJobId: null,
    status: "running",
    phase: "created",
    sourceKind: input.sourceKind,
    sourceName: input.sourceName,
    sourceFingerprint: null,
    filePolicyVersion: FILE_POLICY_VERSION,
    packerVersion: PACKER_VERSION,
    metadata: input.metadata,
    manifestSha256: null,
    manifestJson: null,
    corePackSha256: null,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
    progress: {
      percent: 0,
      processedBytes: 0,
      totalBytes: 0,
      uploadedBytes: 0,
      uploadBytesTotal: 0,
      processedFiles: 0,
      totalFiles: 0,
      uploadedObjects: 0,
      totalUploadObjects: 0,
      currentPath: null,
    },
    stats: emptyStats(),
    error: null,
    result: null,
  };
}

function emptyStats(): UploadTaskStats {
  return {
    sourceFileCount: 0,
    sourceSizeBytes: 0,
    includedFileCount: 0,
    includedSizeBytes: 0,
    excludedFileCount: 0,
    excludedSizeBytes: 0,
    uniqueBlobCount: 0,
    uniqueBlobSizeBytes: 0,
    corePackFileCount: 0,
    corePackRawSizeBytes: 0,
    corePackZipSizeBytes: 0,
    estimatedR2GetCount: 0,
    excludedFileTypes: [],
  };
}

function updateHashProgress(
  task: BrowserUploadTaskSnapshot,
  input: {
    processedBytes: number;
    processedFiles: number;
    currentPath: string;
    includedFileCount: number;
    includedSizeBytes: number;
    excludedFileCount: number;
    excludedSizeBytes: number;
    excludedFileTypes: ExcludedFileTypeSummary[];
  },
): BrowserUploadTaskSnapshot {
  const ratio = input.processedBytes / Math.max(task.stats.sourceSizeBytes, 1);
  return {
    ...setPhase(task, "hashing", ratio, input.currentPath),
    progress: {
      ...task.progress,
      percent: 5 + ratio * 30,
      processedBytes: input.processedBytes,
      processedFiles: input.processedFiles,
      currentPath: input.currentPath,
    },
    stats: {
      ...task.stats,
      includedFileCount: input.includedFileCount,
      includedSizeBytes: input.includedSizeBytes,
      excludedFileCount: input.excludedFileCount,
      excludedSizeBytes: input.excludedSizeBytes,
      excludedFileTypes: input.excludedFileTypes,
    },
  };
}

function updateUploadProgress(
  task: BrowserUploadTaskSnapshot,
  uploadedObjects: number,
  totalObjects: number,
  uploadedBytes: number,
  totalBytes: number,
  currentPath: string,
): BrowserUploadTaskSnapshot {
  const ratio = totalBytes > 0 ? uploadedBytes / totalBytes : 1;
  return {
    ...task,
    updatedAt: new Date().toISOString(),
    progress: {
      ...task.progress,
      percent: 60 + ratio * 30,
      uploadedBytes,
      uploadBytesTotal: totalBytes,
      uploadedObjects,
      totalUploadObjects: totalObjects,
      currentPath,
    },
  };
}

function setPhase(
  task: BrowserUploadTaskSnapshot,
  phase: UploadTaskPhase,
  ratio: number,
  currentPath: string | null,
): BrowserUploadTaskSnapshot {
  const stage = stageWeights[phase];
  return {
    ...task,
    status: "running",
    phase,
    updatedAt: new Date().toISOString(),
    progress: {
      ...task.progress,
      percent: Math.min(100, stage.base + Math.max(0, Math.min(1, ratio)) * stage.weight),
      currentPath,
    },
  };
}

async function persistAndPost(
  task: BrowserUploadTaskSnapshot,
  force = false,
): Promise<BrowserUploadTaskSnapshot> {
  const now = Date.now();
  const last = lastEmitAt.get(task.localTaskId) ?? 0;

  if (!force && now - last < 250) {
    return task;
  }

  lastEmitAt.set(task.localTaskId, now);
  const nextTask = {
    ...task,
    updatedAt: new Date().toISOString(),
  };

  await saveTaskSnapshot(nextTask);
  postMessage({
    type: "task",
    task: nextTask,
  } satisfies UploadWorkerOutput);

  return nextTask;
}

function postLog(localTaskId: string, message: string): void {
  postMessage({
    type: "log",
    localTaskId,
    message,
  } satisfies UploadWorkerOutput);
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await retry(() =>
    fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    }),
  );
  const payload = (await response.json()) as T & { ok?: boolean; error?: string; detail?: string };

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.detail ?? payload.error ?? `Request failed: ${response.status}`);
  }

  return payload;
}

async function retry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Retry failed");
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  );
}

async function waitIfPaused(localTaskId: string): Promise<void> {
  while (pausedTasks.has(localTaskId)) {
    await sleep(250);
  }
}

function assertNotCanceled(localTaskId: string): void {
  if (canceledTasks.has(localTaskId)) {
    throw new Error("任务已取消");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function fingerprintSource(
  files: SourceFile[],
  sourceKind: UploadSourceKind,
): Promise<string> {
  const stableNames = ["RPG_RT.ini", "RPG_RT.ldb", "RPG_RT.lmt"];
  const parts = [
    sourceKind,
    String(files.length),
    String(files.reduce((sum, file) => sum + file.size, 0)),
  ];

  for (const name of stableNames) {
    const file = files.find((item) => item.path.toLowerCase() === name.toLowerCase());
    if (!file) {
      continue;
    }

    parts.push(`${file.path}:${file.size}:${await sha256Bytes(await file.bytes())}`);
  }

  for (const file of files.slice(0, 20)) {
    parts.push(`${file.path}:${file.size}:${file.mtimeMs ?? ""}`);
  }

  return sha256Text(parts.join("\n"));
}

function addExcluded(
  excluded: Map<string, ExcludedFileTypeSummary>,
  fileType: string,
  source: SourceFile,
): void {
  const existing = excluded.get(fileType);

  if (!existing) {
    excluded.set(fileType, {
      fileType,
      fileCount: 1,
      totalSizeBytes: source.size,
      examplePath: source.path,
    });
    return;
  }

  existing.fileCount += 1;
  existing.totalSizeBytes += source.size;
}

function rawRelativePath(file: File): string {
  const withWebkit = file as File & { webkitRelativePath?: string };
  return normalizeArchivePath(withWebkit.webkitRelativePath || file.name);
}

function stripCommonRoot(paths: string[]): Map<string, string> {
  const normalized = paths.map(normalizeArchivePath);
  const firstParts = normalized[0]?.split("/") ?? [];
  const commonRoot = firstParts.length > 1 ? firstParts[0] : null;
  const shouldStrip =
    commonRoot !== null &&
    normalized.every((path) => {
      const parts = path.split("/");
      return parts.length > 1 && parts[0] === commonRoot;
    });
  const result = new Map<string, string>();

  for (const path of normalized) {
    result.set(path, shouldStrip ? path.split("/").slice(1).join("/") : path);
  }

  return result;
}

function inferSourceName(files: File[], sourceKind: UploadSourceKind): string {
  if (sourceKind === "zip") {
    return files[0]?.name ?? "local.zip";
  }

  return inferCleanSourceName(files, sourceKind);
}

function inferCleanSourceName(files: File[], sourceKind: UploadSourceKind): string {
  if (sourceKind === "zip") {
    return files[0]?.name ?? "local.zip";
  }

  const first = files[0] ? rawRelativePath(files[0]) : "local-folder";
  const parts = first.split("/");
  return parts.length > 1 ? parts[0] : "local-folder";
}
