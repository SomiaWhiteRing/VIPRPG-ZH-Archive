/// <reference lib="webworker" />

import {
  clearWebPlayFileRecords,
  saveWebPlayFileRecords,
  saveWebPlayInstallation,
} from "@/app/play/[archiveVersionId]/web-play-db";
import {
  createGameOpfsWriteContext,
  ensureOpfsSupported,
  resetGameOpfsDirectory,
  writeGameFileWithContext,
  writeGameIndexJson,
} from "@/app/play/[archiveVersionId]/web-play-opfs";
import type {
  WebPlayFileRecord,
  WebPlayInstallation,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
} from "@/app/play/[archiveVersionId]/web-play-types";

type EasyRpgCacheNode = {
  _dirname?: string;
  [name: string]: string | EasyRpgCacheNode | undefined;
};

type ZipCentralEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
};

type PreparedZipEntry = {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
};

const canceledPlayKeys = new Set<string>();
const lastEmitAt = new Map<string, number>();
const zipTextDecoder = new TextDecoder();
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const localFileHeaderSignature = 0x04034b50;
const maxWriteConcurrency = 64;
const minWriteConcurrency = 16;
const writeConcurrencyPerHardwareThread = 4;
const initialWriteConcurrency = 8;
const writeConcurrencyRampStep = 4;
const writeConcurrencyRampIntervalMs = 80;
const progressEmitIntervalMs = 80;
const fileRecordBatchSize = 1000;
const localWriteSkippedExtensions = new Set(["dll", "exe", "txt"]);
const easyRpgResourceAliasExtensions = new Set([
  "bmp",
  "gif",
  "jpg",
  "jpeg",
  "mid",
  "midi",
  "mp3",
  "ogg",
  "png",
  "wav",
  "xyz",
]);

self.onmessage = (event: MessageEvent<WebPlayInstallWorkerInput>) => {
  const message = event.data;

  if (message.type === "install") {
    canceledPlayKeys.delete(message.metadata.playKey);
    runInstall(message.metadata, message.storageSnapshot).catch((error: unknown) => {
      postLog(
        message.metadata.playKey,
        "error",
        error instanceof Error ? error.message : "安装失败",
      );
    });
    return;
  }

  if (message.type === "cancel") {
    canceledPlayKeys.add(message.playKey);
  }
};

async function runInstall(
  metadata: WebPlayMetadata,
  storageSnapshot?: WebPlayStorageSnapshot,
): Promise<void> {
  let installation = createInitialInstallation(metadata);

  try {
    installation = await requestStorage(installation, storageSnapshot);
    await resetGameOpfsDirectory(metadata.playKey);
    await clearWebPlayFileRecords(metadata.playKey);

    installation = await persistAndPost(
      {
        ...installation,
        status: "installing",
        phase: "downloading_zip",
        updatedAt: new Date().toISOString(),
      },
      true,
    );

    const indexRoot: EasyRpgCacheNode = {};
    const response = await fetch(metadata.downloadUrl, {
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(`下载 ZIP 失败：HTTP ${response.status}`);
    }

    const headerLength = numberHeader(response.headers.get("Content-Length"));
    installation = await persistAndPost(
      {
        ...installation,
        downloadBytesTotal: headerLength ?? metadata.totalSizeBytes,
      },
      true,
    );

    const result = await extractZipToOpfs({
      metadata,
      response,
      installation,
      indexRoot,
    });
    installation = result.installation;

    assertNotCanceled(metadata.playKey);
    installation = await persistAndPost(
      {
        ...installation,
        phase: "writing_index",
        currentPath: "index.json",
        updatedAt: new Date().toISOString(),
      },
      true,
    );
    await writeGameIndexJson(
      metadata.playKey,
      JSON.stringify({
        cache: indexRoot,
        metadata: {
          version: 2,
          archiveVersionId: metadata.archiveVersionId,
          manifestSha256: metadata.manifestSha256,
        },
      }),
    );

    installation = await persistAndPost(
      {
        ...installation,
        status: "ready",
        phase: "ready",
        readyAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentPath: null,
        error: null,
      },
      true,
    );

    postLog(metadata.playKey, "info", "浏览器本地安装完成。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "安装失败";
    const failed: WebPlayInstallation = {
      ...installation,
      status: canceledPlayKeys.has(metadata.playKey) ? "deleted" : "failed",
      updatedAt: new Date().toISOString(),
      error: message,
    };

    await saveWebPlayInstallation(failed);
    postMessage({
      type: "installation",
      installation: failed,
    } satisfies WebPlayInstallWorkerOutput);
    postLog(metadata.playKey, "error", message);
  }
}

async function requestStorage(
  installation: WebPlayInstallation,
  storageSnapshot?: WebPlayStorageSnapshot,
): Promise<WebPlayInstallation> {
  await ensureOpfsSupported();
  let snapshot = storageSnapshot;

  if (!snapshot) {
    const storage = navigator.storage;
    const estimate = await storage.estimate().catch(() => null);
    const persisted =
      typeof storage.persist === "function"
        ? await storage.persist().catch(() => false)
        : null;

    snapshot = {
      persistedStorage: persisted,
      storageQuotaBytes: estimate?.quota ?? null,
      storageUsageBytes: estimate?.usage ?? null,
    };
  }

  return persistAndPost(
    {
      ...installation,
      phase: "requesting_storage",
      persistedStorage: snapshot.persistedStorage,
      storageQuotaBytes: snapshot.storageQuotaBytes,
      storageUsageBytes: snapshot.storageUsageBytes,
      updatedAt: new Date().toISOString(),
    },
    true,
  );
}

async function extractZipToOpfs(input: {
  metadata: WebPlayMetadata;
  response: Response;
  installation: WebPlayInstallation;
  indexRoot: EasyRpgCacheNode;
}): Promise<{ installation: WebPlayInstallation }> {
  const download = await downloadZipBytes(input);

  return extractStoredZipBytesToOpfs({
    metadata: input.metadata,
    zipBytes: download.bytes,
    installation: download.installation,
    indexRoot: input.indexRoot,
  });
}

async function downloadZipBytes(input: {
  metadata: WebPlayMetadata;
  response: Response;
  installation: WebPlayInstallation;
}): Promise<{ bytes: Uint8Array; installation: WebPlayInstallation }> {
  let installation = input.installation;
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  if (!input.response.body) {
    const bytes = new Uint8Array(await input.response.arrayBuffer());
    installation = await updateDownloadProgress(
      installation,
      input.metadata,
      bytes.byteLength,
      bytes.byteLength,
      true,
    );

    return { bytes, installation };
  }

  const reader = input.response.body.getReader();

  while (true) {
    assertNotCanceled(input.metadata.playKey);
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    downloadedBytes += value.byteLength;
    chunks.push(value);
    installation = await updateDownloadProgress(
      installation,
      input.metadata,
      downloadedBytes,
      installation.downloadBytesTotal,
      false,
    );
  }

  return {
    bytes: concatChunks(chunks, downloadedBytes),
    installation,
  };
}

async function extractStoredZipBytesToOpfs(input: {
  metadata: WebPlayMetadata;
  zipBytes: Uint8Array;
  installation: WebPlayInstallation;
  indexRoot: EasyRpgCacheNode;
}): Promise<{ installation: WebPlayInstallation }> {
  let installation = await persistAndPost(
    {
      ...input.installation,
      phase: "extracting_zip",
      currentPath: null,
      updatedAt: new Date().toISOString(),
    },
    true,
  );
  const entries = readStoredZipCentralDirectory(input.zipBytes);
  const preparedEntries: PreparedZipEntry[] = [];
  let skippedLocalFiles = 0;
  let skippedLocalBytes = 0;

  for (const entry of entries) {
    assertNotCanceled(input.metadata.playKey);

    const normalizedPath = normalizeZipEntryPath(entry.name);

    if (!normalizedPath) {
      continue;
    }

    if (shouldSkipLocalWrite(normalizedPath)) {
      skippedLocalFiles += 1;
      skippedLocalBytes += entry.uncompressedSize;
      continue;
    }

    if (entry.compression !== 0) {
      throw new Error(`当前安装器只支持 store ZIP entry：${normalizedPath}`);
    }

    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error(`ZIP entry 大小异常：${normalizedPath}`);
    }

    addToEasyRpgIndex(input.indexRoot, normalizedPath);
    preparedEntries.push({
      path: normalizedPath,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      dataOffset: entry.dataOffset,
    });
  }

  const installTotalSizeBytes = sumPreparedEntryBytes(preparedEntries);
  installation = await persistAndPost(
    {
      ...installation,
      totalFiles: preparedEntries.length,
      totalSizeBytes: installTotalSizeBytes,
      updatedAt: new Date().toISOString(),
    },
    true,
  );

  if (skippedLocalFiles > 0) {
    postLog(
      input.metadata.playKey,
      "info",
      `本地写入跳过 ${skippedLocalFiles.toLocaleString(
        "zh-CN",
      )} 个 TXT / EXE / DLL 文件，约 ${formatBytes(skippedLocalBytes)}。`,
    );
  }

  const writeConcurrency = resolveWriteConcurrency(preparedEntries.length);

  postLog(
    input.metadata.playKey,
    "info",
    `本地写入使用滚动调度，目标 ${writeConcurrency} 路并发。`,
  );

  installation = await writePreparedEntriesToOpfs({
    metadata: input.metadata,
    zipBytes: input.zipBytes,
    installation,
    entries: preparedEntries,
    writeConcurrency,
  });

  return { installation };
}

async function writePreparedEntriesToOpfs(input: {
  metadata: WebPlayMetadata;
  zipBytes: Uint8Array;
  installation: WebPlayInstallation;
  entries: PreparedZipEntry[];
  writeConcurrency: number;
}): Promise<WebPlayInstallation> {
  let cursor = 0;
  let activeWrites = 0;
  let completedWrites = 0;
  let failed = false;
  let desiredConcurrency = Math.min(
    input.writeConcurrency,
    initialWriteConcurrency,
    input.entries.length,
  );
  let installedFiles = 0;
  let installedBytes = 0;
  let currentPath: string | null = null;
  let installation = input.installation;
  let lastProgressAt = 0;
  let progressWrite = Promise.resolve();
  const writeContext = await createGameOpfsWriteContext(input.metadata.playKey);
  const fileRecords: WebPlayFileRecord[] = new Array(input.entries.length);

  const queueProgress = (force = false) => {
    const now = Date.now();

    if (!force && now - lastProgressAt < progressEmitIntervalMs) {
      return;
    }

    lastProgressAt = now;
    const snapshot = {
      installedFiles,
      installedBytes,
      currentPath,
      updatedAt: new Date().toISOString(),
    };

    progressWrite = progressWrite.then(async () => {
      installation = await persistAndPost(
        {
          ...installation,
          phase: "extracting_zip",
          installedFiles: snapshot.installedFiles,
          installedBytes: snapshot.installedBytes,
          currentPath: snapshot.currentPath,
          updatedAt: snapshot.updatedAt,
        },
        true,
      );
    });
  };

  if (input.entries.length === 0) {
    return installation;
  }

  await new Promise<void>((resolve, reject) => {
    let rampTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (rampTimer) {
        clearInterval(rampTimer);
        rampTimer = null;
      }
    };
    const finishIfDone = () => {
      if (completedWrites >= input.entries.length && activeWrites === 0) {
        cleanup();
        resolve();
      }
    };
    const fail = (error: unknown) => {
      if (!failed) {
        failed = true;
        cleanup();
        reject(error);
      }
    };
    const runOne = async (index: number) => {
      assertNotCanceled(input.metadata.playKey);
      const entry = input.entries[index];
      const fileBytes = input.zipBytes.subarray(
        entry.dataOffset,
        entry.dataOffset + entry.compressedSize,
      );

      await writeGameFileWithContext(writeContext, entry.path, fileBytes);

      const updatedAt = new Date().toISOString();

      fileRecords[index] = {
        id: `${input.metadata.playKey}:${entry.path}`,
        playKey: input.metadata.playKey,
        path: entry.path,
        size: entry.uncompressedSize,
        updatedAt,
      };
      installedFiles += 1;
      installedBytes += entry.uncompressedSize;
      currentPath = entry.path;
      queueProgress();
    };
    const schedule = () => {
      if (failed) {
        return;
      }

      while (activeWrites < desiredConcurrency && cursor < input.entries.length) {
        const index = cursor;
        cursor += 1;
        activeWrites += 1;

        void runOne(index)
          .then(() => {
            completedWrites += 1;
          })
          .catch(fail)
          .finally(() => {
            activeWrites -= 1;

            if (!failed) {
              schedule();
              finishIfDone();
            }
          });
      }

      finishIfDone();
    };

    rampTimer = setInterval(() => {
      if (failed || desiredConcurrency >= input.writeConcurrency) {
        cleanup();
        return;
      }

      desiredConcurrency = Math.min(
        input.writeConcurrency,
        desiredConcurrency + writeConcurrencyRampStep,
      );
      schedule();
    }, writeConcurrencyRampIntervalMs);

    schedule();
  }).catch(async (error: unknown) => {
    await progressWrite;
    throw error;
  });

  queueProgress(true);
  await progressWrite;
  await saveFileRecordsInBatches(fileRecords);

  return persistAndPost(
    {
      ...installation,
      phase: "extracting_zip",
      installedFiles,
      installedBytes,
      currentPath,
      updatedAt: new Date().toISOString(),
    },
    true,
  );
}

async function updateDownloadProgress(
  installation: WebPlayInstallation,
  metadata: WebPlayMetadata,
  downloadedBytes: number,
  downloadBytesTotal: number,
  force: boolean,
): Promise<WebPlayInstallation> {
  assertNotCanceled(metadata.playKey);

  return persistAndPost(
    {
      ...installation,
      phase: "downloading_zip",
      downloadedBytes,
      downloadBytesTotal,
      updatedAt: new Date().toISOString(),
    },
    force,
  );
}

function createInitialInstallation(metadata: WebPlayMetadata): WebPlayInstallation {
  const now = new Date().toISOString();

  return {
    playKey: metadata.playKey,
    archiveVersionId: metadata.archiveVersionId,
    manifestSha256: metadata.manifestSha256,
    downloadZipBuilderVersion: metadata.downloadZipBuilderVersion,
    webPlayInstallerVersion: metadata.webPlayInstallerVersion,
    easyRpgRuntimeVersion: metadata.easyRpgRuntimeVersion,
    title: metadata.title,
    releaseLabel: metadata.releaseLabel,
    archiveLabel: metadata.archiveLabel,
    status: "created",
    phase: "metadata",
    createdAt: now,
    updatedAt: now,
    readyAt: null,
    lastPlayedAt: null,
    totalFiles: metadata.totalFiles,
    totalSizeBytes: metadata.totalSizeBytes,
    downloadedBytes: 0,
    downloadBytesTotal: 0,
    installedFiles: 0,
    installedBytes: 0,
    currentPath: null,
    persistedStorage: null,
    storageQuotaBytes: null,
    storageUsageBytes: null,
    error: null,
  };
}

function resolveWriteConcurrency(entryCount: number): number {
  if (entryCount <= 0) {
    return 1;
  }

  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : minWriteConcurrency / writeConcurrencyPerHardwareThread;
  const target = Math.max(
    minWriteConcurrency,
    Math.ceil(hardwareConcurrency * writeConcurrencyPerHardwareThread),
  );

  return Math.max(1, Math.min(entryCount, maxWriteConcurrency, target));
}

async function saveFileRecordsInBatches(
  records: WebPlayFileRecord[],
): Promise<void> {
  for (let offset = 0; offset < records.length; offset += fileRecordBatchSize) {
    await saveWebPlayFileRecords(records.slice(offset, offset + fileRecordBatchSize));
  }
}

async function persistAndPost(
  installation: WebPlayInstallation,
  force = false,
): Promise<WebPlayInstallation> {
  const now = Date.now();
  const last = lastEmitAt.get(installation.playKey) ?? 0;

  if (!force && now - last < 250) {
    return installation;
  }

  lastEmitAt.set(installation.playKey, now);
  await saveWebPlayInstallation(installation);
  postMessage({
    type: "installation",
    installation,
  } satisfies WebPlayInstallWorkerOutput);

  return installation;
}

function addToEasyRpgIndex(root: EasyRpgCacheNode, path: string): void {
  const parts = path.split("/");
  const fileName = parts.at(-1) ?? "";
  const parentParts = parts.slice(0, -1);

  addEasyRpgIndexEntry(root, parts, path, fileName, true);

  const alias = easyRpgResourceAliasForFile(fileName);

  if (alias) {
    addEasyRpgIndexEntry(root, [...parentParts, alias], path, fileName, false);
  }
}

function addEasyRpgIndexEntry(
  root: EasyRpgCacheNode,
  parts: string[],
  sourcePath: string,
  fileName: string,
  strict: boolean,
): void {
  let node = root;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const folded = part.toLowerCase();
    const isFile = index === parts.length - 1;

    if (isFile) {
      const existing = node[folded];

      if (existing !== undefined) {
        if (strict) {
          throw new Error(`EasyRPG 文件名大小写冲突：${sourcePath}`);
        }

        return;
      }

      node[folded] = fileName;
      return;
    }

    const existing = node[folded];

    if (typeof existing === "string") {
      throw new Error(`EasyRPG 路径冲突：${sourcePath}`);
    }

    if (!existing) {
      const child: EasyRpgCacheNode = { _dirname: part };
      node[folded] = child;
      node = child;
      continue;
    }

    if (existing._dirname !== part) {
      throw new Error(`EasyRPG 目录名大小写冲突：${sourcePath}`);
    }

    node = existing;
  }
}

function easyRpgResourceAliasForFile(fileName: string): string | null {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }

  const extension = fileName.slice(dotIndex + 1).toLowerCase();

  if (!easyRpgResourceAliasExtensions.has(extension)) {
    return null;
  }

  return fileName.slice(0, dotIndex);
}

function shouldSkipLocalWrite(path: string): boolean {
  const fileName = path.split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return false;
  }

  return localWriteSkippedExtensions.has(fileName.slice(dotIndex + 1).toLowerCase());
}

function sumPreparedEntryBytes(entries: PreparedZipEntry[]): number {
  return entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  let next = value;

  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (next < 1024 || unit === "GB") {
      return unit === "B" ? `${next} B` : `${next.toFixed(2)} ${unit}`;
    }

    next /= 1024;
  }

  return `${value} B`;
}

function normalizeZipEntryPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized || normalized.endsWith("/")) {
    return null;
  }

  if (
    normalized.includes("\0") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..") ||
    normalized === ".." ||
    /^[a-z]+:/i.test(normalized)
  ) {
    throw new Error(`ZIP 内存在非法路径：${path}`);
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .join("/");
}

function assertNotCanceled(playKey: string): void {
  if (canceledPlayKeys.has(playKey)) {
    throw new Error("安装已取消。");
  }
}

function numberHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : null;
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function readStoredZipCentralDirectory(zipBytes: Uint8Array): ZipCentralEntry[] {
  const eocdOffset = findEndOfCentralDirectory(zipBytes);
  const entryCount = readUint16(zipBytes, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(zipBytes, eocdOffset + 16);
  const entries: ZipCentralEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(zipBytes, offset) !== centralDirectorySignature) {
      throw new Error("ZIP 中央目录损坏。");
    }

    const flags = readUint16(zipBytes, offset + 8);
    const compression = readUint16(zipBytes, offset + 10);
    const compressedSize = readUint32(zipBytes, offset + 20);
    const uncompressedSize = readUint32(zipBytes, offset + 24);
    const nameLength = readUint16(zipBytes, offset + 28);
    const extraLength = readUint16(zipBytes, offset + 30);
    const commentLength = readUint16(zipBytes, offset + 32);
    const localHeaderOffset = readUint32(zipBytes, offset + 42);
    const nameStart = offset + 46;
    const nameBytes = zipBytes.subarray(nameStart, nameStart + nameLength);
    const name = decodeZipPath(nameBytes, flags);

    if (readUint32(zipBytes, localHeaderOffset) !== localFileHeaderSignature) {
      throw new Error(`ZIP local header 损坏：${name}`);
    }

    const localNameLength = readUint16(zipBytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(zipBytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

    if (dataOffset + compressedSize > zipBytes.byteLength) {
      throw new Error(`ZIP entry 超出文件边界：${name}`);
    }

    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(zipBytes: Uint8Array): number {
  const minOffset = Math.max(0, zipBytes.byteLength - 22 - 65535);

  for (let offset = zipBytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(zipBytes, offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }

  throw new Error("未找到 ZIP 中央目录。");
}

function decodeZipPath(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0) {
    postLog(
      "zip",
      "warning",
      "ZIP entry 未标记 UTF-8，仍按 UTF-8 解码。若路径异常，需要重新评估路径字节策略。",
    );
  }

  return zipTextDecoder.decode(bytes);
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

function postLog(
  playKey: string,
  level: "info" | "warning" | "error",
  message: string,
): void {
  postMessage({
    type: "log",
    playKey,
    level,
    message,
  } satisfies WebPlayInstallWorkerOutput);
}
