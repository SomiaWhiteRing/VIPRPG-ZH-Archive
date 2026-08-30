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
import type {
  BrowserUploadTaskSnapshot,
  MetadataBlobUpload,
  PreparedArchiveSource,
  UploadRecoveryDraft,
  UploadSourceFile,
  UploadSourceKind,
  UploadTaskCommitResult,
  UploadTaskPhase,
  UploadTaskStats,
  UploadWorkerInput,
  UploadWorkerOutput,
} from "@/app/upload/upload-types";
import {
  deleteUploadDraft,
  draftKey,
  putUploadDraft,
  sourceObjectReferences,
} from "@/app/upload/upload-drafts";

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

type UploadRuntime = {
  task: BrowserUploadTaskSnapshot;
  preparedSource: PreparedArchiveSource | null;
  metadata: ArchiveCommitMetadata | null;
  metadataBlobs: MetadataBlobUpload[];
  joining: boolean;
  creatingJob: Promise<BrowserUploadTaskSnapshot> | null;
  cancelAttempt: Promise<boolean> | null;
  settled: boolean;
};

type OwnedImportJobState = {
  status: string;
  result: UploadTaskCommitResult | null;
};

const stageWeights: Record<UploadTaskPhase, { base: number; weight: number }> = {
  enumerating: { base: 0, weight: 5 },
  hashing: { base: 5, weight: 30 },
  building_core_pack: { base: 35, weight: 15 },
  creating_import_job: { base: 50, weight: 5 },
  preflighting: { base: 55, weight: 5 },
  uploading_source: { base: 60, weight: 30 },
  verifying_source: { base: 90, weight: 0 },
  awaiting_metadata: { base: 90, weight: 0 },
  uploading_metadata: { base: 90, weight: 4 },
  committing: { base: 94, weight: 6 },
  completed: { base: 100, weight: 0 },
};

let currentRuntime: UploadRuntime | null = null;
let lastEmitAt = 0;
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

  if (message.type === "start_source") {
    void startSource(message);
    return;
  }
  if (message.type === "confirm_metadata") {
    void confirmMetadata(message);
    return;
  }
  if (message.type === "revoke_metadata") {
    void revokeMetadata(message.localTaskId);
    return;
  }
  if (message.type === "restore") {
    void restoreDraft(message.draft);
    return;
  }
  if (message.type === "cancel") {
    void cancelRuntime(message.localTaskId);
  }
};

async function startSource(
  message: Extract<UploadWorkerInput, { type: "start_source" }>,
): Promise<void> {
  if (currentRuntime) return;
  const localTaskId = message.localTaskId;
  const now = new Date().toISOString();
  let task = createInitialTask({
    accountId: message.accountId,
    localTaskId,
    sourceKind: message.sourceKind,
    sourceName: message.sourceName,
    targetWorkId: message.targetWorkId,
    now,
  });
  const runtime: UploadRuntime = {
    task,
    preparedSource: null,
    metadata: null,
    metadataBlobs: [],
    joining: false,
    creatingJob: null,
    cancelAttempt: null,
    settled: false,
  };
  currentRuntime = runtime;

  try {
    task = setPhase(task, "enumerating", 1, null);
    runtime.task = task = emitTask(task, true);
    const sourceFiles = await enumerateSourceFiles(message.files, message.sourceKind);
    await waitForCancellation(runtime);
    const sourceSize = sourceFiles.reduce((sum, file) => sum + file.size, 0);

    task = {
      ...task,
      sourceName: message.sourceName,
      stats: {
        ...task.stats,
        sourceFileCount: sourceFiles.length,
        sourceSizeBytes: sourceSize,
      },
    };
    task = setPhase(task, "hashing", 0, null);
    runtime.task = task = emitTask(task, true);

    const scan = await scanAndHash(task, sourceFiles);
    runtime.task = task = scan.task;
    await waitForCancellation(runtime);

    const corePack = await buildCorePack(task, scan.coreFiles);
    runtime.task = task = corePack.task;
    await waitForCancellation(runtime);
    task = {
      ...task,
      stats: {
        ...task.stats,
        corePackFileCount: corePack.corePack.fileCount,
        corePackRawSizeBytes: corePack.corePack.uncompressedSize,
        corePackZipSizeBytes: corePack.corePack.bytes.byteLength,
        estimatedR2GetCount: scan.blobObjects.size + 1,
      },
      progress: {
        ...task.progress,
        percent: 50,
      },
    };
    runtime.task = task = emitTask(task, true);

    await waitForCancellation(runtime);
    const creatingJob = createImportJob(task).then((nextTask) => {
      runtime.task = nextTask;
      return nextTask;
    });
    runtime.creatingJob = creatingJob;
    try {
      task = await creatingJob;
    } finally {
      if (runtime.creatingJob === creatingJob) runtime.creatingJob = null;
    }
    runtime.task = task;
    await waitForCancellation(runtime);
    const preflight = await preflightObjects(
      task,
      [...scan.blobObjects.values()].map((blob) => ({
        sha256: blob.sha256,
        sizeBytes: blob.size,
      })),
      [
        {
          sha256: corePack.corePack.sha256,
          sizeBytes: corePack.corePack.bytes.byteLength,
        },
      ],
    );
    runtime.task = task = preflight.task;
    await waitForCancellation(runtime);

    task = await uploadMissingObjects({
      task,
      blobObjects: scan.blobObjects,
      corePack: corePack.corePack,
      missingBlobs: preflight.missingBlobs,
      missingCorePacks: preflight.missingCorePacks,
    });

    runtime.task = task;
    await waitForCancellation(runtime);
    const preparedSource: PreparedArchiveSource = {
      sourceKind: message.sourceKind,
      sourceName: task.sourceName,
      files: toManifestFiles(scan.includedFiles),
      corePack: {
        sha256: corePack.corePack.sha256,
        size: corePack.corePack.bytes.byteLength,
        uncompressedSize: corePack.corePack.uncompressedSize,
        fileCount: corePack.corePack.fileCount,
      },
      stats: task.stats,
    };
    await markSourceReady(task.serverImportJobId, preparedSource);
    await waitForCancellation(runtime);
    runtime.preparedSource = preparedSource;
    runtime.task = task = {
      ...task,
      status: "waiting",
      phase: "awaiting_metadata",
      sourceReady: true,
      progress: {
        ...task.progress,
        percent: 90,
        currentPath: null,
      },
    };
    runtime.task = emitTask(task, true);
    await saveRuntimeDraft(runtime);
    await tryJoin(runtime);
  } catch (error) {
    if (error instanceof RuntimeSettledError || runtime.settled) return;
    if (runtime.cancelAttempt && await runtime.cancelAttempt) return;
    await failRuntime(runtime, error);
  }
}

async function confirmMetadata(
  message: Extract<UploadWorkerInput, { type: "confirm_metadata" }>,
): Promise<void> {
  const runtime = runtimeFor(message.localTaskId);
  if (!runtime || runtime.cancelAttempt || runtime.task.commitStarted || isTerminal(runtime.task.status)) return;
  runtime.metadata = message.metadata;
  runtime.metadataBlobs = message.metadataBlobs;
  runtime.task = emitTask(
    { ...runtime.task, metadataConfirmed: true, error: null },
    true,
  );
  if (runtime.preparedSource) await saveRuntimeDraft(runtime);
  await tryJoin(runtime);
}

async function revokeMetadata(localTaskId: string): Promise<void> {
  const runtime = runtimeFor(localTaskId);
  if (!runtime || runtime.cancelAttempt || runtime.task.commitStarted || isTerminal(runtime.task.status)) return;
  runtime.metadata = null;
  runtime.metadataBlobs = [];
  runtime.task = emitTask(
    { ...runtime.task, metadataConfirmed: false, status: runtime.task.sourceReady ? "waiting" : "running" },
    true,
  );
  if (runtime.preparedSource) await saveRuntimeDraft(runtime);
}

async function restoreDraft(draft: UploadRecoveryDraft): Promise<void> {
  if (currentRuntime) return;
  const task = createInitialTask({
    accountId: draft.accountId,
    localTaskId: draft.localTaskId,
    sourceKind: draft.preparedSource.sourceKind,
    sourceName: draft.preparedSource.sourceName,
    targetWorkId: draft.targetWorkId,
    now: draft.createdAt,
  });
  const runtime: UploadRuntime = {
    task: {
      ...task,
      serverImportJobId: draft.serverImportJobId,
      status: "waiting",
      phase: "awaiting_metadata",
      sourceReady: true,
      metadataConfirmed: draft.metadataConfirmed,
      stats: draft.preparedSource.stats,
      progress: { ...task.progress, percent: 90 },
    },
    preparedSource: draft.preparedSource,
    metadata: draft.metadata,
    metadataBlobs: draft.metadataBlobs,
    joining: false,
    creatingJob: null,
    cancelAttempt: null,
    settled: false,
  };
  currentRuntime = runtime;
  try {
    runtime.task = emitTask(runtime.task, true);
    await tryJoin(runtime);
  } catch (error) {
    if (error instanceof RuntimeSettledError || runtime.settled) return;
    if (runtime.cancelAttempt && await runtime.cancelAttempt) return;
    await failRuntime(runtime, error);
  }
}

async function tryJoin(runtime: UploadRuntime): Promise<void> {
  if (
    runtime.joining ||
    !runtime.preparedSource ||
    !runtime.metadata ||
    !runtime.task.metadataConfirmed ||
    !runtime.task.serverImportJobId ||
    runtime.cancelAttempt ||
    runtime.settled ||
    isTerminal(runtime.task.status)
  ) return;
  await waitForCancellation(runtime);
  const importJobId = runtime.task.serverImportJobId;
  const preparedSource = runtime.preparedSource;
  const metadata = runtime.metadata;
  runtime.joining = true;
  runtime.task = {
    ...runtime.task,
    status: "running",
    phase: "uploading_metadata",
    commitStarted: true,
    progress: { ...runtime.task.progress, percent: 90 },
  };
  runtime.task = emitTask(runtime.task, true);
  try {
    await markMetadataReady(importJobId);
    await waitForCancellation(runtime);
    await uploadMetadataBlobs(runtime.metadataBlobs, importJobId);
    await waitForCancellation(runtime);
    const manifestResult = await buildManifest(preparedSource, metadata);
    await waitForCancellation(runtime);
    runtime.task = setPhase(runtime.task, "committing", 0, null);
    runtime.task = emitTask(runtime.task, true);
    const result = await commitTask(
      importJobId,
      manifestResult.manifestSha256,
      manifestResult.manifestJson,
      metadata,
      preparedSource.stats.excludedFileTypes,
    );
    await settleRuntime(runtime, {
      ...runtime.task,
      status: "completed",
      phase: "completed",
      error: null,
      result,
      progress: { ...runtime.task.progress, percent: 100, currentPath: null },
    });
  } catch (error) {
    if (error instanceof RuntimeSettledError || runtime.settled) return;
    if (runtime.cancelAttempt && await runtime.cancelAttempt) return;
    await failRuntime(runtime, error);
  } finally {
    runtime.joining = false;
  }
}

async function cancelRuntime(localTaskId: string): Promise<void> {
  const runtime = runtimeFor(localTaskId);
  if (!runtime || runtime.settled) return;
  if (runtime.task.phase === "committing" || isTerminal(runtime.task.status)) {
    await rejectCancellation(runtime, "任务正在提交，当前不能取消或离开上传页。");
    return;
  }
  if (runtime.cancelAttempt) return;
  const attempt = performCancellation(runtime);
  runtime.cancelAttempt = attempt;
  try {
    await attempt;
  } finally {
    if (runtime.cancelAttempt === attempt) runtime.cancelAttempt = null;
  }
}

async function performCancellation(runtime: UploadRuntime): Promise<boolean> {
  if (runtime.creatingJob) {
    await runtime.creatingJob.catch(() => null);
  }
  if (runtime.settled) return true;
  if (runtime.task.phase === "committing") {
    await rejectCancellation(runtime, "任务正在提交，当前不能取消或离开上传页。");
    return false;
  }
  const importJobId = runtime.task.serverImportJobId;
  if (!importJobId) {
    await settleRuntime(runtime, {
      ...runtime.task,
      status: "canceled",
      error: null,
    });
    return true;
  }

  const state = await requestTerminalTransition(
    importJobId,
    "cancel",
    undefined,
    "canceled",
  );
  if (!state || !isTerminalImportJobStatus(state.status)) {
    await rejectCancellation(runtime, "服务端尚未确认取消，上传任务和恢复草稿均已保留。");
    return false;
  }
  await settleRuntime(runtime, terminalTaskFromState(runtime.task, state, "上传任务已结束"));
  return true;
}

async function rejectCancellation(runtime: UploadRuntime, message: string): Promise<void> {
  runtime.task = emitTask({
    ...runtime.task,
    error: message,
  }, true);
  postMessage({
    type: "cancel_rejected",
    task: runtime.task,
    message,
  } satisfies UploadWorkerOutput);
}

async function failRuntime(runtime: UploadRuntime, error: unknown): Promise<void> {
  if (runtime.settled) return;
  const message = error instanceof Error ? error.message : "上传任务失败";
  let state: OwnedImportJobState | null = null;
  if (runtime.task.serverImportJobId) {
    state = await requestTerminalTransition(
      runtime.task.serverImportJobId,
      "fail",
      { message, stage: runtime.task.phase },
      "failed",
    );
  }
  if (!runtime.task.serverImportJobId) {
    await settleRuntime(runtime, {
      ...runtime.task,
      status: "failed",
      error: message,
    });
    return;
  }
  if (state && isTerminalImportJobStatus(state.status)) {
    await settleRuntime(runtime, terminalTaskFromState(runtime.task, state, message));
    return;
  }

  runtime.task = emitTask({
    ...runtime.task,
    status: runtime.preparedSource ? "waiting" : "running",
    error: runtime.preparedSource
      ? `${message}；服务端终态尚未确认，恢复草稿已保留。`
      : `${message}；服务端终态尚未确认，请重试取消。`,
  }, true);
  if (runtime.preparedSource) await saveRuntimeDraft(runtime);
}

function terminalTaskFromState(
  task: BrowserUploadTaskSnapshot,
  state: OwnedImportJobState,
  fallbackError: string,
): BrowserUploadTaskSnapshot {
  if (state.status === "completed") {
    return {
      ...task,
      status: "completed",
      phase: "completed",
      error: null,
      result: state.result,
      progress: { ...task.progress, percent: 100, currentPath: null },
    };
  }
  if (state.status === "canceled") {
    return { ...task, status: "canceled", error: null };
  }
  return { ...task, status: "failed", error: fallbackError };
}

async function enumerateSourceFiles(
  files: UploadSourceFile[],
  sourceKind: UploadSourceKind,
): Promise<SourceFile[]> {
  if (sourceKind === "zip") {
    return enumerateZipSourceFiles(files);
  }
  return files
    .map((source) => {
      const path = normalizeArchivePath(source.relativePath);
      const file = source.file;

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

async function enumerateZipSourceFiles(files: UploadSourceFile[]): Promise<SourceFile[]> {
  const zipFile = files[0]?.file;

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
          currentPath: result.source.path,
          includedFileCount: includedFiles.length,
          includedSizeBytes: includedSize,
          excludedFileCount: processedFiles - includedFiles.length,
          excludedSizeBytes: excludedSize,
          excludedFileTypes: [...excluded.values()],
        });
        task = emitTask(task);
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
  assertRuntimeActive(localTaskId);

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
  task = emitTask(task, true);
  const zipEntries: Record<string, Uint8Array> = {};
  let rawSize = 0;
  let processed = 0;

  for (const file of coreFiles) {
    assertRuntimeActive(task.localTaskId);
    zipEntries[file.packEntryPath ?? file.path] =
      file.cachedBytes ?? (await file.source.bytes());
    rawSize += file.size;
    processed += 1;
    task = setPhase(
      task,
      "building_core_pack",
      processed / Math.max(coreFiles.length, 1),
      file.path,
    );
    task = emitTask(task);
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

async function buildManifest(
  source: PreparedArchiveSource,
  metadata: ArchiveCommitMetadata,
): Promise<{
  manifestJson: string;
  manifestSha256: string;
}> {
  const manifest: ArchiveManifest = {
    schema: "viprpg-archive.manifest.v1",
    game: {
      originalTitle: metadata.game.originalTitle,
      chineseTitle: metadata.game.chineseTitle,
      language: metadata.game.language,
      isOriginal: metadata.game.isOriginal,
    },
    archiveVersion: {
      sourceName: metadata.archiveVersion.sourceName,
      sourceUrl: metadata.archiveVersion.sourceUrl,
      createdAt: new Date().toISOString(),
      filePolicyVersion: FILE_POLICY_VERSION,
      packerVersion: PACKER_VERSION,
      sourceType: source.sourceKind === "zip" ? "browser_zip" : "browser_folder",
      sourceFileCount: source.stats.sourceFileCount,
      sourceSize: source.stats.sourceSizeBytes,
      includedFileCount: source.stats.includedFileCount,
      includedSize: source.stats.includedSizeBytes,
      excludedFileCount: source.stats.excludedFileCount,
      excludedSize: source.stats.excludedSizeBytes,
    },
    corePacks: [
      {
        id: "core-main",
        sha256: source.corePack.sha256,
        size: source.corePack.size,
        uncompressedSize: source.corePack.uncompressedSize,
        fileCount: source.corePack.fileCount,
        format: "zip",
        compression: "deflate-low",
      },
    ],
    files: source.files,
  };
  const manifestJson = JSON.stringify(manifest);

  return {
    manifestJson,
    manifestSha256: await sha256Text(manifestJson),
  };
}

function toManifestFiles(includedFiles: IncludedFile[]): ArchiveManifestFile[] {
  return includedFiles.map((file) => ({
    path: file.path,
    pathSortKey: file.pathSortKey,
    role: file.role,
    sha256: file.sha256,
    crc32: file.crc32,
    size: file.size,
    mtimeMs: file.mtimeMs,
    storage: file.storageKind === "blob"
      ? { kind: "blob", blobSha256: file.sha256 }
      : {
          kind: "core_pack",
          packId: "core-main",
          entry: file.packEntryPath ?? file.path,
        },
  }));
}

async function createImportJob(
  initialTask: BrowserUploadTaskSnapshot,
): Promise<BrowserUploadTaskSnapshot> {
  let task = setPhase(initialTask, "creating_import_job", 0, null);
  task = emitTask(task, true);
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
      targetWorkId: task.targetWorkId,
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
  task = emitTask(task, true);

  if (!task.serverImportJobId) {
    throw new Error("上传任务缺少导入记录，无法进行上传前检查。");
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

  task = {
    ...task,
    progress: {
      ...task.progress,
      percent: 60,
    },
  };
  task = emitTask(task, true);

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
  if (!input.task.serverImportJobId) throw new Error("上传任务缺少导入记录");
  const importJobId = input.task.serverImportJobId;
  let task = setPhase(input.task, "uploading_source", 0, null);
  let uploadedBytes = 0;
  const totalBytes =
    [...input.missingBlobs].reduce(
      (sum, sha256) => sum + (input.blobObjects.get(sha256)?.size ?? 0),
      0,
    ) +
    (input.missingCorePacks.has(input.corePack.sha256)
      ? input.corePack.bytes.byteLength
      : 0);

  task = emitTask(task, true);

  if (input.missingCorePacks.has(input.corePack.sha256)) {
    assertRuntimeActive(task.localTaskId);
    await uploadCorePack(input.corePack, importJobId);
    uploadedBytes += input.corePack.bytes.byteLength;
    task = updateUploadProgress(
      task,
      uploadedBytes,
      totalBytes,
      "引擎公共文件",
    );
    task = emitTask(task, true);
  }

  const missingBlobObjects = [...input.missingBlobs]
    .map((sha256) => input.blobObjects.get(sha256))
    .filter((item): item is BlobObject => Boolean(item))
    .sort((a, b) => b.size - a.size);

  await runWithConcurrency(missingBlobObjects, resolveUploadConcurrency(), async (blob) => {
    assertRuntimeActive(task.localTaskId);
    await uploadBlob(blob, importJobId);
    uploadedBytes += blob.size;
    task = updateUploadProgress(
      task,
      uploadedBytes,
      totalBytes,
      blob.source.path,
    );
    emitTask(task);
  });

  task = setPhase(task, "verifying_source", 1, null);
  return emitTask(task, true);
}

async function commitTask(
  importJobId: number,
  manifestSha256: string,
  manifestJson: string,
  metadata: ArchiveCommitMetadata,
  excludedFileTypes: ExcludedFileTypeSummary[],
): Promise<UploadTaskCommitResult> {
  const body = JSON.stringify({
    manifestSha256,
    manifestJson,
    metadata,
    excludedFileTypes,
  });

  let response: Response;
  try {
    response = await fetch(`/api/imports/${importJobId}/commit`, {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const completed = await waitForCompletedImportResult(importJobId);
    if (completed) return completed;
    throw error;
  }
  const payload = (await response.json().catch(() => null)) as
    | { ok: true; result: UploadTaskCommitResult }
    | { ok: false; detail?: string; error?: string }
    | null;
  if (response.ok && payload?.ok) return payload.result;
  const completed = await waitForCompletedImportResult(importJobId);
  if (completed) return completed;
  throw new Error(
    payload && "detail" in payload
      ? payload.detail || payload.error || "提交入库失败"
      : "提交入库失败",
  );
}

async function waitForCompletedImportResult(
  importJobId: number,
): Promise<UploadTaskCommitResult | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const state = await readOwnedImportJobState(importJobId).catch(() => null);
    if (state?.status === "completed") return state.result;
    if (state?.status !== "committing") return null;
    if (attempt < 5) await sleep(250 * 2 ** Math.min(attempt, 3));
  }
  return null;
}

async function readOwnedImportJobState(
  importJobId: number,
): Promise<OwnedImportJobState | null> {
  const response = await fetch(`/api/imports/${importJobId}`, {
    credentials: "same-origin",
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as {
    ok: true;
    importJob: {
      status: string;
      result: UploadTaskCommitResult | null;
    };
  } | null;
  return payload?.ok ? payload.importJob : null;
}

async function requestTerminalTransition(
  importJobId: number,
  action: "cancel" | "fail",
  body: { message: string; stage: string } | undefined,
  expectedStatus: "canceled" | "failed",
): Promise<OwnedImportJobState | null> {
  const response = await fetch(`/api/imports/${importJobId}/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (response?.ok) {
    return await readOwnedImportJobState(importJobId).catch(() => null) ?? {
      status: expectedStatus,
      result: null,
    };
  }
  return readOwnedImportJobState(importJobId).catch(() => null);
}

function isTerminalImportJobStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled" || status === "expired";
}

async function markSourceReady(
  importJobId: number | null,
  source: PreparedArchiveSource,
): Promise<void> {
  if (!importJobId) throw new Error("上传任务缺少导入记录");
  const references = sourceObjectReferences(source);
  await jsonFetch(`/api/imports/${importJobId}/source-ready`, {
    method: "POST",
    body: JSON.stringify(references),
  });
}

async function markMetadataReady(importJobId: number): Promise<void> {
  await jsonFetch(`/api/imports/${importJobId}/metadata-ready`, {
    method: "POST",
  });
}

async function saveRuntimeDraft(runtime: UploadRuntime): Promise<void> {
  const { task, preparedSource } = runtime;
  if (!task.serverImportJobId || !preparedSource) return;
  const draft: UploadRecoveryDraft = {
    key: draftKey(task.accountId, task.serverImportJobId),
    accountId: task.accountId,
    localTaskId: task.localTaskId,
    serverImportJobId: task.serverImportJobId,
    targetWorkId: task.targetWorkId,
    preparedSource,
    metadata: runtime.metadata,
    metadataBlobs: runtime.metadataBlobs,
    metadataConfirmed: task.metadataConfirmed,
    createdAt: task.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await putUploadDraft(draft);
  postMessage({ type: "draft_saved", draft } satisfies UploadWorkerOutput);
}

async function removeRuntimeDraft(runtime: UploadRuntime): Promise<boolean> {
  const jobId = runtime.task.serverImportJobId;
  if (!jobId) return true;
  try {
    await deleteUploadDraft(runtime.task.accountId, jobId);
    return true;
  } catch {
    return false;
  }
}

async function settleRuntime(
  runtime: UploadRuntime,
  task: BrowserUploadTaskSnapshot,
): Promise<void> {
  if (runtime.settled) return;
  runtime.settled = true;
  runtime.task = emitTask(task, true);
  const draftRemoved = await removeRuntimeDraft(runtime);
  postMessage({
    type: "settled",
    task: runtime.task,
    draftRemoved,
  } satisfies UploadWorkerOutput);
}

async function waitForCancellation(runtime: UploadRuntime): Promise<void> {
  const attempt = runtime.cancelAttempt;
  if (attempt && await attempt) throw new RuntimeSettledError();
  if (runtime.settled) throw new RuntimeSettledError();
}

function runtimeFor(localTaskId: string): UploadRuntime | null {
  return currentRuntime?.task.localTaskId === localTaskId ? currentRuntime : null;
}

function isTerminal(status: BrowserUploadTaskSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

async function uploadCorePack(
  corePack: CorePackObject,
  importJobId: number,
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

async function uploadBlob(blob: BlobObject, importJobId: number): Promise<void> {
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

async function uploadMetadataBlobs(blobs: MetadataBlobUpload[], importJobId: number | null): Promise<void> {
  if (!importJobId) throw new Error("上传任务缺少导入记录");
  for (const blob of blobs) {
    await retry(async () => {
      const response = await fetch(uploadObjectUrl(`/api/blobs/${blob.sha256}`, importJobId), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": blob.contentType },
        body: await blob.file.arrayBuffer(),
      });
      if (!response.ok) throw new Error(`图片上传失败：${blob.file.name}`);
    });
  }
}

function uploadObjectUrl(path: string, importJobId: number): string {
  return `${path}?import_job_id=${encodeURIComponent(String(importJobId))}`;
}

function createInitialTask(input: {
  accountId: number;
  localTaskId: string;
  sourceKind: UploadSourceKind;
  sourceName: string;
  targetWorkId: number | null;
  now: string;
}): BrowserUploadTaskSnapshot {
  return {
    accountId: input.accountId,
    localTaskId: input.localTaskId,
    serverImportJobId: null,
    targetWorkId: input.targetWorkId,
    status: "running",
    phase: "enumerating",
    sourceKind: input.sourceKind,
    sourceName: input.sourceName,
    sourceReady: false,
    metadataConfirmed: false,
    commitStarted: false,
    createdAt: input.now,
    progress: {
      percent: 0,
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
  uploadedBytes: number,
  totalBytes: number,
  currentPath: string,
): BrowserUploadTaskSnapshot {
  const ratio = totalBytes > 0 ? uploadedBytes / totalBytes : 1;
  return {
    ...task,
    progress: {
      ...task.progress,
      percent: 60 + ratio * 30,
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
    progress: {
      ...task.progress,
      percent: Math.min(100, stage.base + Math.max(0, Math.min(1, ratio)) * stage.weight),
      currentPath,
    },
  };
}

function emitTask(
  task: BrowserUploadTaskSnapshot,
  force = false,
): BrowserUploadTaskSnapshot {
  const now = Date.now();

  if (!force && now - lastEmitAt < 250) {
    return task;
  }

  lastEmitAt = now;
  postMessage({
    type: "task",
    task,
  } satisfies UploadWorkerOutput);

  return task;
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

function assertRuntimeActive(localTaskId: string): void {
  const runtime = runtimeFor(localTaskId);
  if (!runtime || runtime.settled) throw new RuntimeSettledError();
}

class RuntimeSettledError extends Error {}

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
