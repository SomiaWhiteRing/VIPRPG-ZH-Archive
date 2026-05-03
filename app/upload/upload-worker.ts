/// <reference lib="webworker" />

import { inflate, zip } from "fflate";
import {
  classifyArchivePath,
  contentTypeForArchivePath,
  FILE_POLICY_VERSION,
  normalizeArchivePath,
  PACKER_VERSION,
} from "@/lib/archive/file-policy";
import { crc32 } from "@/lib/archive/crc32";
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
  crc32: number;
  size: number;
  mtimeMs: number | null;
  contentType: string;
  packEntryPath: string | null;
  source: SourceFile;
  cachedBytes?: Uint8Array;
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

type ZipCentralEntry = {
  normalizedPath: string;
  compressedSize: number;
  uncompressedSize: number;
  compression: number;
  flags: number;
  localHeaderOffset: number;
  mtimeMs: number | null;
};

type ScanFileResult =
  | {
      kind: "excluded";
      source: SourceFile;
      fileType: string;
    }
  | {
      kind: "included";
      source: SourceFile;
      included: IncludedFile;
    };

type LegacyZipEncoding = "utf-8" | "shift_jis" | "gb18030";

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
const utf8ZipTextDecoder = new TextDecoder("utf-8");
const fatalUtf8ZipTextDecoder = new TextDecoder("utf-8", { fatal: true });
const shiftJisZipTextDecoder = new TextDecoder("shift_jis");
const gb18030ZipTextDecoder = new TextDecoder("gb18030");
const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipUtf8Flag = 0x0800;
const zipMethodStore = 0;
const zipMethodDeflate = 8;
const zipEncryptedFlag = 0x0001;
const maxHashConcurrency = 16;
const minHashConcurrency = 4;
const hashConcurrencyPerHardwareThread = 2;
const maxUploadConcurrency = 16;
const minUploadConcurrency = 6;
const uploadConcurrencyPerHardwareThread = 2;
const hashByteBudgetBytes = 256 * 1024 * 1024;

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
    return enumerateZipSourceFiles(files);
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

async function enumerateZipSourceFiles(files: File[]): Promise<SourceFile[]> {
  const zipFile = files[0];

  if (!zipFile) {
    throw new Error("未选择 ZIP 文件");
  }

  const entries = await readZipCentralDirectory(zipFile);
  const paths = stripCommonRoot(entries.map((entry) => entry.normalizedPath));

  return entries
    .map((entry) => {
      const path = paths.get(entry.normalizedPath) ?? entry.normalizedPath;

      return {
        path,
        size: entry.uncompressedSize,
        mtimeMs: entry.mtimeMs,
        contentType: contentTypeForArchivePath(path),
        bytes: async () => readZipEntryBytes(zipFile, entry),
      } satisfies SourceFile;
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
  let recordResult = Promise.resolve();

  await runWithByteBudget(
    sourceFiles,
    resolveHashConcurrency(),
    hashByteBudgetBytes,
    async (source) => scanOneFile(task.localTaskId, source),
    async (result) => {
      recordResult = recordResult.then(async () => {
        processedFiles += 1;
        processedBytes += result.source.size;

        if (result.kind === "excluded") {
          excludedSize += result.source.size;
          addExcluded(excluded, result.fileType, result.source);
        } else {
          includedFiles.push(result.included);
          includedSize += result.included.size;

          if (result.included.storageKind === "core_pack") {
            coreFiles.push(result.included);
          }
        }

        task = updateHashProgress(task, {
          processedBytes,
          processedFiles,
          currentPath: result.source.path,
          includedFileCount: includedFiles.length,
          includedSizeBytes: includedSize,
          excludedFileCount: processedFiles - includedFiles.length,
          excludedSizeBytes: excludedSize,
          excludedFileTypes: [...excluded.values()],
        });
        task = await persistAndPost(task);
      });

      await recordResult;
    },
  );

  await recordResult;

  includedFiles.sort((a, b) => a.pathSortKey.localeCompare(b.pathSortKey));
  coreFiles.sort((a, b) => a.pathSortKey.localeCompare(b.pathSortKey));

  for (const included of includedFiles) {
    if (included.storageKind !== "blob" || blobObjects.has(included.sha256)) {
      continue;
    }

    blobObjects.set(included.sha256, {
      sha256: included.sha256,
      size: included.size,
      contentType: included.contentType,
      source: included.source,
      uploaded: false,
    });
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

async function scanOneFile(
  localTaskId: string,
  source: SourceFile,
): Promise<ScanFileResult> {
  await waitIfPaused(localTaskId);
  assertNotCanceled(localTaskId);

  const classification = classifyArchivePath(source.path);

  if (!classification.included) {
    return {
      kind: "excluded",
      source,
      fileType: classification.fileType,
    };
  }

  const bytes = await source.bytes();
  const sha256 = await sha256Bytes(bytes);
  const included: IncludedFile = {
    path: source.path,
    pathSortKey: source.path.toLowerCase(),
    role: classification.role,
    storageKind: classification.storageKind,
    sha256,
    crc32: crc32(bytes),
    size: source.size,
    mtimeMs: source.mtimeMs,
    contentType: source.contentType,
    packEntryPath: classification.packEntryPath,
    source,
    cachedBytes: classification.storageKind === "core_pack" ? bytes : undefined,
  };

  return {
    kind: "included",
    source,
    included,
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
  const sortedCoreFiles = coreFiles
    .slice()
    .sort((a, b) => a.pathSortKey.localeCompare(b.pathSortKey));

  for (const file of sortedCoreFiles) {
    await waitIfPaused(task.localTaskId);
    assertNotCanceled(task.localTaskId);
    zipEntries[file.packEntryPath ?? file.path] =
      file.cachedBytes ?? (await file.source.bytes());
    rawSize += file.size;
    processed += 1;
    task = setPhase(
      task,
      "building_core_pack",
      processed / Math.max(sortedCoreFiles.length, 1),
      file.path,
    );
    task = await persistAndPost(task);
  }

  const bytes = await zipEntriesAsync(zipEntries);
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
      crc32: file.crc32,
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

  await runWithConcurrency(missingBlobObjects, resolveUploadConcurrency(), async (blob) => {
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
      body: asArrayBufferView(corePack.bytes),
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
      body: asArrayBufferView(bytes),
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

async function runWithByteBudget<T extends { size: number }, R>(
  items: T[],
  concurrency: number,
  maxActiveBytes: number,
  worker: (item: T) => Promise<R>,
  onResult: (result: R) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let activeCount = 0;
  let activeBytes = 0;
  let completedCount = 0;
  let failed = false;

  await new Promise<void>((resolve, reject) => {
    const schedule = () => {
      if (failed) {
        return;
      }

      while (nextIndex < items.length && activeCount < concurrency) {
        const item = items[nextIndex];
        const itemBytes = Math.max(1, item.size);

        if (
          activeCount > 0 &&
          (itemBytes > maxActiveBytes || activeBytes + itemBytes > maxActiveBytes)
        ) {
          break;
        }

        nextIndex += 1;
        activeCount += 1;
        activeBytes += itemBytes;

        void worker(item)
          .then(onResult)
          .then(() => {
            completedCount += 1;
          })
          .catch((error: unknown) => {
            failed = true;
            reject(error);
          })
          .finally(() => {
            activeCount -= 1;
            activeBytes -= itemBytes;

            if (failed) {
              return;
            }

            if (completedCount >= items.length) {
              resolve();
              return;
            }

            schedule();
          });
      }
    };

    if (items.length === 0) {
      resolve();
      return;
    }

    schedule();
  });
}

function resolveHashConcurrency(): number {
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : minHashConcurrency / hashConcurrencyPerHardwareThread;

  return Math.max(
    1,
    Math.min(
      maxHashConcurrency,
      Math.max(
        minHashConcurrency,
        Math.ceil(hardwareConcurrency * hashConcurrencyPerHardwareThread),
      ),
    ),
  );
}

function resolveUploadConcurrency(): number {
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : minUploadConcurrency / uploadConcurrencyPerHardwareThread;

  return Math.max(
    1,
    Math.min(
      maxUploadConcurrency,
      Math.max(
        minUploadConcurrency,
        Math.ceil(hardwareConcurrency * uploadConcurrencyPerHardwareThread),
      ),
    ),
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

async function zipEntriesAsync(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 1, consume: true }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });
}

async function inflateBytes(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    inflate(bytes, { size, consume: true }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", asArrayBufferView(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function asArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }

  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy;
}

async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function fingerprintSource(
  files: SourceFile[],
  sourceKind: UploadSourceKind,
): Promise<string> {
  const parts = [
    sourceKind,
    String(files.length),
    String(files.reduce((sum, file) => sum + file.size, 0)),
  ];
  const sampleFiles = [
    ...files.slice(0, 20),
    ...files.slice(Math.max(20, files.length - 20)),
  ];

  for (const file of sampleFiles) {
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

  if (source.path.localeCompare(existing.examplePath) < 0) {
    existing.examplePath = source.path;
  }
}

async function readZipCentralDirectory(zipFile: File): Promise<ZipCentralEntry[]> {
  const tailLength = Math.min(zipFile.size, 22 + 65535);
  const tailStart = zipFile.size - tailLength;
  const tail = new Uint8Array(await zipFile.slice(tailStart).arrayBuffer());
  const eocdOffset = findEndOfCentralDirectory(tail);
  const diskNumber = readUint16(tail, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(tail, eocdOffset + 6);
  const entryCount = readUint16(tail, eocdOffset + 10);
  const centralDirectorySize = readUint32(tail, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(tail, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error("暂不支持分卷 ZIP 上传。");
  }

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("暂不支持 ZIP64 上传。");
  }

  const central = new Uint8Array(
    await zipFile
      .slice(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize)
      .arrayBuffer(),
  );
  const legacyEncoding = chooseLegacyZipEncoding(central);
  const entries: ZipCentralEntry[] = [];
  let offset = 0;

  while (offset < central.byteLength) {
    if (offset + 46 > central.byteLength) {
      throw new Error("ZIP 中央目录截断。");
    }

    if (readUint32(central, offset) !== centralDirectorySignature) {
      throw new Error("ZIP 中央目录损坏。");
    }

    const flags = readUint16(central, offset + 8);
    const compression = readUint16(central, offset + 10);
    const modifiedTime = readUint16(central, offset + 12);
    const modifiedDate = readUint16(central, offset + 14);
    const compressedSize = readUint32(central, offset + 20);
    const uncompressedSize = readUint32(central, offset + 24);
    const nameLength = readUint16(central, offset + 28);
    const extraLength = readUint16(central, offset + 30);
    const commentLength = readUint16(central, offset + 32);
    const localHeaderOffset = readUint32(central, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd + extraLength + commentLength > central.byteLength) {
      throw new Error("ZIP 中央目录文件名截断。");
    }

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("暂不支持包含 ZIP64 entry 的上传包。");
    }

    if ((flags & zipEncryptedFlag) !== 0) {
      throw new Error("暂不支持加密 ZIP 上传。");
    }

    if (compression !== zipMethodStore && compression !== zipMethodDeflate) {
      throw new Error(`暂不支持 ZIP 压缩方法 ${compression}。`);
    }

    const name = decodeZipPath(
      central.subarray(nameStart, nameEnd),
      flags,
      legacyEncoding,
    );
    const normalizedPath = normalizeArchivePath(name);

    if (normalizedPath && !normalizedPath.endsWith("/")) {
      entries.push({
        normalizedPath,
        compressedSize,
        uncompressedSize,
        compression,
        flags,
        localHeaderOffset,
        mtimeMs: dosDateTimeToMs(modifiedDate, modifiedTime),
      });
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntryBytes(
  zipFile: File,
  entry: ZipCentralEntry,
): Promise<Uint8Array> {
  const fixed = new Uint8Array(
    await zipFile
      .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
      .arrayBuffer(),
  );

  if (fixed.byteLength !== 30 || readUint32(fixed, 0) !== localFileHeaderSignature) {
    throw new Error(`ZIP local header 损坏：${entry.normalizedPath}`);
  }

  const nameLength = readUint16(fixed, 26);
  const extraLength = readUint16(fixed, 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(
    await zipFile.slice(dataOffset, dataOffset + entry.compressedSize).arrayBuffer(),
  );

  if (compressed.byteLength !== entry.compressedSize) {
    throw new Error(`ZIP entry 数据截断：${entry.normalizedPath}`);
  }

  if (entry.compression === zipMethodStore) {
    if (compressed.byteLength !== entry.uncompressedSize) {
      throw new Error(`ZIP store entry 大小异常：${entry.normalizedPath}`);
    }

    return compressed;
  }

  return inflateBytes(compressed, entry.uncompressedSize);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }

  throw new Error("未找到 ZIP 中央目录。");
}

function chooseLegacyZipEncoding(central: Uint8Array): LegacyZipEncoding {
  const scores: Record<LegacyZipEncoding, number> = {
    "utf-8": 0,
    shift_jis: 0,
    gb18030: 0,
  };
  let offset = 0;
  let sampled = 0;

  while (offset < central.byteLength && sampled < 1000) {
    if (offset + 46 > central.byteLength) {
      break;
    }

    if (readUint32(central, offset) !== centralDirectorySignature) {
      break;
    }

    const flags = readUint16(central, offset + 8);
    const nameLength = readUint16(central, offset + 28);
    const extraLength = readUint16(central, offset + 30);
    const commentLength = readUint16(central, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd + extraLength + commentLength > central.byteLength) {
      break;
    }

    if ((flags & zipUtf8Flag) === 0) {
      const bytes = central.subarray(nameStart, nameEnd);
      const utf8 = tryDecodeUtf8(bytes);

      scores["utf-8"] += utf8 ? scoreLegacyZipPath(utf8) : -1000;
      scores.shift_jis += scoreLegacyZipPath(shiftJisZipTextDecoder.decode(bytes));
      scores.gb18030 += scoreLegacyZipPath(gb18030ZipTextDecoder.decode(bytes));
      sampled += 1;
    }

    offset = nameEnd + extraLength + commentLength;
  }

  if (sampled === 0) {
    return "utf-8";
  }

  return (Object.entries(scores) as Array<[LegacyZipEncoding, number]>).sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0] ?? "shift_jis";
}

function decodeZipPath(
  bytes: Uint8Array,
  flags: number,
  legacyEncoding: LegacyZipEncoding,
): string {
  if ((flags & zipUtf8Flag) !== 0) {
    return utf8ZipTextDecoder.decode(bytes);
  }

  switch (legacyEncoding) {
    case "utf-8":
      return utf8ZipTextDecoder.decode(bytes);
    case "gb18030":
      return gb18030ZipTextDecoder.decode(bytes);
    case "shift_jis":
      return shiftJisZipTextDecoder.decode(bytes);
  }
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8ZipTextDecoder.decode(bytes);
  } catch {
    return null;
  }
}

function scoreLegacyZipPath(value: string): number {
  let score = 0;

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    if (char === "\uFFFD" || code === 0 || (code < 0x20 && char !== "\t")) {
      score -= 100;
      continue;
    }

    if (isHiragana(code) || isKatakana(code)) {
      score += 8;
      continue;
    }

    if (isCjk(code)) {
      score += 2;
      continue;
    }

    if (code >= 0x20 && code <= 0x7e) {
      score += 1;
      continue;
    }

    score -= 1;
  }

  return score;
}

function isHiragana(code: number): boolean {
  return code >= 0x3040 && code <= 0x309f;
}

function isKatakana(code: number): boolean {
  return (
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xff65 && code <= 0xff9f)
  );
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function dosDateTimeToMs(date: number, time: number): number | null {
  if (date === 0) {
    return null;
  }

  const year = ((date >> 9) & 0x7f) + 1980;
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const value = new Date(year, month, day, hour, minute, second).getTime();

  return Number.isFinite(value) ? value : null;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
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
