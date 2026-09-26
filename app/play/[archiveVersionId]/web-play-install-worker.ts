/// <reference lib="webworker" />

import {
  clearWebPlayFileRecords,
  getWebPlayInstallation,
  saveWebPlayFileRecords,
  saveWebPlayInstallation,
} from "@/app/play/[archiveVersionId]/web-play-db";
import {
  createGamePackWritable,
  ensureOpfsSupported,
  resetGameOpfsDirectory,
  writeGamePackIndexJson,
} from "@/app/play/[archiveVersionId]/web-play-opfs";
import type {
  WebPlayFileRecord,
  WebPlayInstallation,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
  WebPlayStorageKind,
} from "@/app/play/[archiveVersionId]/web-play-types";
import { contentTypeForArchivePath } from "@/lib/archive/file-policy";
import { shouldSkipWebPlayLocalWrite } from "@/lib/archive/web-play-local-policy";
import { withGameResourceWriteLock } from "./web-play-locks";
import { cacheWebPlayCover } from "./web-play-cover";
import { renewGameBucket } from "./web-play-storage";
import { notifyGameResourcesChanged } from "./web-play-events";
import { finishInstallObservation, installObserver, observeInstallTask, startInstallObservation } from "./web-play-install-observer";

type LocalZipEntry = {
  name: string;
  flags: number;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
};

type WebPlayPackIndex = {
  version: 1;
  archiveVersionId: number;
  manifestSha256: string;
  webPlayInstallerVersion: string;
  packs: Array<{
    name: string;
    size: number;
  }>;
  files: Record<
    string,
    {
      path: string;
      pack: string;
      offset: number;
      length: number;
      crc32: number;
      contentType: string;
    }
  >;
};

type PackEntryLocation = {
  pack: string;
  offset: number;
};

type ByteChunk = Uint8Array<ArrayBufferLike>;

const canceledPlayKeys = new Set<string>();
const lastEmitAt = new Map<string, number>();
const zipTextDecoder = new TextDecoder();
const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipDataDescriptorFlag = 0x0008;
const zipMethodStore = 0;
const progressEmitIntervalMs = 80;
const diagnosticLogIntervalMs = 5000;
const fileRecordBatchSize = 1000;
const packTargetSizeBytes = 256 * 1024 * 1024;
const packWriteBufferTargetBytes = 1024 * 1024;
const maxInstallAttempts = 3;
const retryBaseDelayMs = 1500;

self.onmessage = (event: MessageEvent<WebPlayInstallWorkerInput>) => {
  const message = event.data;

  if (message.type === "install") {
    startInstallObservation(message);
    canceledPlayKeys.delete(message.metadata.playKey);
    observeInstallTask("install.lock-and-run", () => withGameResourceWriteLock(message.metadata.playKey, () => {
      installObserver?.event("lock.acquired");
      return runInstall(message.metadata, message.storageKind, message.storageSnapshot);
    }), { playKey: message.metadata.playKey }).then(() => {
      notifyGameResourcesChanged();
      finishInstallObservation("finished");
      postMessage({ type: "install-finished" } satisfies WebPlayInstallWorkerOutput);
    }).catch((error: unknown) => {
      finishInstallObservation("rejected");
      postMessage({
        type: "install-rejected",
        message: error instanceof Error ? error.message : "安装失败",
      } satisfies WebPlayInstallWorkerOutput);
    });
    return;
  }

  if (message.type === "cancel") {
    installObserver?.event("cancel.received", { playKey: message.playKey });
    canceledPlayKeys.add(message.playKey);
  }
};

async function runInstall(
  metadata: WebPlayMetadata,
  storageKind: WebPlayStorageKind,
  storageSnapshot?: WebPlayStorageSnapshot,
): Promise<void> {
  let installation: WebPlayInstallation = { ...createInitialInstallation(metadata), storageKind };

  try {
    const previous = await observeInstallTask("idb.previous-installation", () => getWebPlayInstallation(metadata.playKey));
    if (previous) await observeInstallTask("opfs.reset-previous", () => resetGameOpfsDirectory(previous));
    // Persist the resource location before writing any files or caching a cover.
    await observeInstallTask("idb.initial-installation", () => saveWebPlayInstallation(installation));
    if (metadata.coverBlobSha256) {
      await observeInstallTask("cover.cache", () => cacheWebPlayCover(metadata.coverBlobSha256!)).catch(() => {});
    }
    installation = await requestStorage(installation, storageSnapshot);

    for (let attempt = 1; attempt <= maxInstallAttempts; attempt += 1) {
      installObserver?.event("attempt.start", { attempt, maxInstallAttempts });
      try {
        installation = await runInstallAttempt({
          metadata,
          installation,
          attempt,
        });
        return;
      } catch (error) {
        installObserver?.event("attempt.error", { attempt, error, retryable: isRetryableInstallError(error), canceled: canceledPlayKeys.has(metadata.playKey) });
        if (canceledPlayKeys.has(metadata.playKey) || !isRetryableInstallError(error)) {
          throw error;
        }

        if (attempt >= maxInstallAttempts) {
          throw error;
        }

        const delayMs = retryDelayMs(attempt);
        const message = error instanceof Error ? error.message : "安装失败";

        postLog(
          metadata.playKey,
          "warning",
          `安装遇到可重试错误：${message}。${formatDuration(
            delayMs,
          )} 后自动重试（${attempt + 1}/${maxInstallAttempts}）。`,
        );
        await observeInstallTask("retry.wait", () => delay(delayMs), { attempt, nextAttempt: attempt + 1, delayMs, restartsFromZero: true });
        assertNotCanceled(metadata.playKey);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "安装失败";
    const failed: WebPlayInstallation = {
      ...((await observeInstallTask("idb.failed-read", () => getWebPlayInstallation(metadata.playKey))) ?? installation),
      status: canceledPlayKeys.has(metadata.playKey) ? "deleted" : "failed",
      updatedAt: new Date().toISOString(),
      error: message,
    };

    await observeInstallTask("idb.failed-save", () => saveWebPlayInstallation(failed));
    installObserver?.event("installation", { ...failed });
    postMessage({
      type: "installation",
      installation: failed,
    } satisfies WebPlayInstallWorkerOutput);
    postLog(metadata.playKey, "error", message);
  }
}

async function runInstallAttempt(input: {
  metadata: WebPlayMetadata;
  installation: WebPlayInstallation;
  attempt: number;
}): Promise<WebPlayInstallation> {
  const { metadata, attempt } = input;
  let installation = input.installation;

  assertNotCanceled(metadata.playKey);

  if (attempt > 1) {
    postLog(
      metadata.playKey,
      "info",
      `正在重新安装游戏文件（${attempt}/${maxInstallAttempts}）。`,
    );
  }

  await observeInstallTask("opfs.reset-attempt", () => resetGameOpfsDirectory(installation), { attempt });
  await observeInstallTask("idb.clear-files", () => clearWebPlayFileRecords(metadata.playKey));

  installation = await persistAndPost(
    {
      ...installation,
      status: "installing",
      phase: "downloading_zip",
      downloadedBytes: 0,
      downloadBytesTotal: 0,
      installedFiles: 0,
      installedBytes: 0,
      currentPath: null,
      error: null,
      updatedAt: new Date().toISOString(),
    },
    true,
  );

  const response = await observeInstallTask("network.headers", () => fetch(metadata.downloadUrl, {
    credentials: "same-origin",
  }), { url: metadata.downloadUrl });

  if (!response.ok) {
    throw new Error(`下载游戏文件失败（状态码 ${response.status}），请重试。`);
  }

  const headerLength = numberHeader(response.headers.get("Content-Length"));
  installation = await persistAndPost(
    {
      ...installation,
      downloadBytesTotal: headerLength ?? metadata.installTotalSizeBytes,
      updatedAt: new Date().toISOString(),
    },
    true,
  );

  const result = await streamZipToPacks({
    metadata,
    response,
    installation,
  });
  installation = result.installation;

  assertNotCanceled(metadata.playKey);
  installation = await persistAndPost(
    {
      ...installation,
      phase: "writing_index",
      currentPath: "pack-index.json",
      updatedAt: new Date().toISOString(),
    },
    true,
  );
  await observeInstallTask("opfs.write-index", () => writeGamePackIndexJson(installation, JSON.stringify(result.packIndex)), { files: Object.keys(result.packIndex.files).length });

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

  postLog(
    metadata.playKey,
    "info",
    "游戏文件已安装到浏览器，可以启动游戏。",
  );

  return installation;
}

async function requestStorage(
  installation: WebPlayInstallation,
  storageSnapshot?: WebPlayStorageSnapshot,
): Promise<WebPlayInstallation> {
  await observeInstallTask("storage.support", () => ensureOpfsSupported());
  let snapshot = storageSnapshot;

  if (!snapshot) {
    const storage = navigator.storage;
    const estimate = await observeInstallTask("storage.estimate", () => storage.estimate()).catch(() => null);
    // Permission requests belong to the window; the worker only reads status.
    const persisted =
      typeof storage.persisted === "function"
        ? await observeInstallTask("storage.persisted", () => storage.persisted()).catch(() => null)
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

async function streamZipToPacks(input: {
  metadata: WebPlayMetadata;
  response: Response;
  installation: WebPlayInstallation;
}): Promise<{
  installation: WebPlayInstallation;
  packIndex: WebPlayPackIndex;
}> {
  let installation = await persistAndPost(
    {
      ...input.installation,
      phase: "extracting_zip",
      currentPath: null,
      updatedAt: new Date().toISOString(),
    },
    true,
  );
  let downloadedBytes = installation.downloadedBytes;
  let installedFiles = 0;
  let installedBytes = 0;
  let currentPath: string | null = null;
  let lastProgressAt = 0;
  let lastDiagnosticAt = nowMs();
  let progressWrite = Promise.resolve();
  let pendingProgressWrites = 0;
  const fileRecords: WebPlayFileRecord[] = [];
  const packWriter = new PackWriter(installation);
  const packIndex: WebPlayPackIndex = {
    version: 1,
    archiveVersionId: input.metadata.archiveVersionId,
    manifestSha256: input.metadata.manifestSha256,
    webPlayInstallerVersion: input.metadata.webPlayInstallerVersion,
    packs: packWriter.packs,
    files: {},
  };

  const queueProgress = (force = false) => {
    const now = Date.now();

    if (!force && now - lastProgressAt < progressEmitIntervalMs) {
      return;
    }

    lastProgressAt = now;
    const snapshot = {
      downloadedBytes,
      installedFiles,
      installedBytes,
      currentPath,
      updatedAt: new Date().toISOString(),
    };

    pendingProgressWrites += 1;
    const queuedAt = installObserver ? performance.now() : 0;
    installObserver?.event("progress.queued", { queueDepth: pendingProgressWrites, ...snapshot });
    progressWrite = progressWrite.then(async () => {
      installObserver?.event("progress.dequeued", { queueDepth: pendingProgressWrites, waitMs: performance.now() - queuedAt });
      try {
        installation = await persistAndPost(
          {
            ...installation,
            phase: "extracting_zip",
            downloadedBytes: snapshot.downloadedBytes,
            installedFiles: snapshot.installedFiles,
            installedBytes: snapshot.installedBytes,
            currentPath: snapshot.currentPath,
            updatedAt: snapshot.updatedAt,
          },
          true,
        );
      } finally {
        pendingProgressWrites -= 1;
        installObserver?.event("progress.settled", { queueDepth: pendingProgressWrites });
      }
    });
  };

  const logDiagnostics = (force = false) => {
    const now = nowMs();
    const elapsedMs = now - lastDiagnosticAt;

    if (!force && elapsedMs < diagnosticLogIntervalMs) {
      return;
    }

    postLog(
      input.metadata.playKey,
      "info",
      `正在安装游戏文件：已下载 ${formatBytes(downloadedBytes)} / ${formatBytes(
        installation.downloadBytesTotal || input.metadata.installTotalSizeBytes,
      )}；已安装 ${installedFiles.toLocaleString(
        "zh-CN",
      )} / ${input.metadata.installTotalFiles.toLocaleString("zh-CN")} 个文件。`,
    );

    lastDiagnosticAt = now;
  };

  let body: ReadableStream<ByteChunk> | null = input.response.body;

  if (!body) {
    const bytes = new Uint8Array(await observeInstallTask("network.array-buffer-fallback", () => input.response.arrayBuffer()));
    downloadedBytes = bytes.byteLength;
    queueProgress(true);
    body = streamBytes(bytes);
  }

  if (!body) {
    throw new Error("浏览器无法读取下载内容，请重试。");
  }

  const reader = new ZipStreamReader(input.metadata.playKey, body, (bytes) => {
    downloadedBytes = bytes;
    queueProgress();
    logDiagnostics();
  });

  postLog(
    input.metadata.playKey,
    "info",
    "正在安装游戏文件…",
  );

  try {
    while (true) {
      assertNotCanceled(input.metadata.playKey);
      const entry = await observeInstallTask("zip.header", () => reader.readNextEntry(), { offset: reader.offset });

      if (!entry) {
        await observeInstallTask("zip.drain", () => reader.drainToEnd(), { offset: reader.offset });
        break;
      }
      const normalizedPath = normalizeZipEntryPath(entry.name);
      installObserver?.event("zip.entry", { path: normalizedPath ?? entry.name, dataOffset: reader.offset, ...entry, installedFiles });

      if (entry.compression !== zipMethodStore) {
        throw new Error(`游戏压缩包使用了暂不支持的压缩方式：${normalizedPath ?? entry.name}`);
      }

      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new Error(`游戏压缩包中的文件大小异常：${normalizedPath ?? entry.name}`);
      }

      if (!normalizedPath) {
        await observeInstallTask("zip.skip", () => reader.discardBytes(entry.compressedSize), { path: entry.name, bytes: entry.compressedSize, reason: "directory-or-empty-path" });
        logDiagnostics();
        continue;
      }

      if (shouldSkipWebPlayLocalWrite(normalizedPath)) {
        await observeInstallTask("zip.skip", () => reader.discardBytes(entry.compressedSize), { path: normalizedPath, bytes: entry.compressedSize, reason: "local-file-policy" });
        logDiagnostics();
        continue;
      }

      currentPath = normalizedPath;

      const location = await packWriter.beginEntry(entry.uncompressedSize);
      queueProgress();
      const lookupKey = packLookupKey(normalizedPath);

      if (packIndex.files[lookupKey]) {
        throw new Error(`游戏文件路径冲突：${normalizedPath}`);
      }

      await observeInstallTask("zip.install-entry", () => reader.pipeBytes(entry.compressedSize, async (chunk) => {
        await packWriter.write(chunk);
      }), { path: normalizedPath, bytes: entry.compressedSize, ...location });

      packIndex.files[lookupKey] = {
        path: normalizedPath,
        pack: location.pack,
        offset: location.offset,
        length: entry.uncompressedSize,
        crc32: entry.crc32,
        contentType: contentTypeForArchivePath(normalizedPath),
      };

      const updatedAt = new Date().toISOString();

      fileRecords.push({
        id: `${input.metadata.playKey}:${normalizedPath}`,
        playKey: input.metadata.playKey,
        path: normalizedPath,
        size: entry.uncompressedSize,
        updatedAt,
      });
      installedFiles += 1;
      installedBytes += entry.uncompressedSize;
      queueProgress();
      logDiagnostics();
    }
  } finally {
    await packWriter.close();
    await observeInstallTask("progress.drain-finally", () => progressWrite, { queueDepth: pendingProgressWrites }).catch(() => undefined);
  }

  queueProgress(true);
  await observeInstallTask("progress.drain", () => progressWrite, { queueDepth: pendingProgressWrites });
  await saveFileRecordsInBatches(fileRecords);
  logDiagnostics(true);

  return {
    installation: await persistAndPost(
      {
        ...installation,
        phase: "extracting_zip",
        totalFiles: installedFiles,
        totalSizeBytes: installedBytes,
        downloadedBytes,
        installedFiles,
        installedBytes,
        currentPath,
        updatedAt: new Date().toISOString(),
      },
      true,
    ),
    packIndex,
  };
}

class PackWriter {
  readonly packs: Array<{ name: string; size: number }> = [];

  private writable: FileSystemWritableFileStream | null = null;
  private currentPack: { name: string; size: number } | null = null;
  private pendingChunks: ByteChunk[] = [];
  private pendingBytes = 0;
  private nextPackIndex = 0;

  constructor(private readonly installation: WebPlayInstallation) {}

  async beginEntry(length: number): Promise<PackEntryLocation> {
    if (
      !this.currentPack ||
      (this.currentPack.size > 0 &&
        this.currentPack.size + length > packTargetSizeBytes)
    ) {
      await this.rotatePack();
    }

    if (!this.currentPack) {
      throw new Error("无法保存游戏文件，请重新安装。");
    }

    return {
      pack: this.currentPack.name,
      offset: this.currentPack.size,
    };
  }

  async write(chunk: ByteChunk): Promise<void> {
    if (!this.currentPack) {
      throw new Error("无法保存游戏文件，请重新安装。");
    }

    this.pendingChunks.push(chunk);
    this.pendingBytes += chunk.byteLength;
    this.currentPack.size += chunk.byteLength;

    if (this.pendingBytes >= packWriteBufferTargetBytes) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    if (!this.writable) {
      return;
    }

    await this.flush();
    const writable = this.writable;
    const pack = this.currentPack;

    this.writable = null;
    this.currentPack = null;
    await observeInstallTask("opfs.close", () => writable.close(), { pack: pack?.name, bytes: pack?.size });
  }

  private async rotatePack(): Promise<void> {
    await this.close();

    const name = `assets-${String(this.nextPackIndex).padStart(3, "0")}.pack`;

    this.nextPackIndex += 1;
    this.currentPack = { name, size: 0 };
    this.packs.push(this.currentPack);
    this.writable = await observeInstallTask("opfs.create-pack", () => createGamePackWritable({ ...this.installation, updatedAt: new Date().toISOString() }, name), { pack: name });
  }

  private async flush(): Promise<void> {
    if (!this.writable) {
      throw new Error("无法保存游戏文件，请重新安装。");
    }

    if (this.pendingBytes === 0) {
      return;
    }

    const coalesceStarted = installObserver ? performance.now() : 0;
    const bytes = coalesceChunks(this.pendingChunks, this.pendingBytes);
    installObserver?.event("buffer.coalesce", { bytes: bytes.byteLength, chunks: this.pendingChunks.length, durationMs: performance.now() - coalesceStarted });

    this.pendingChunks = [];
    this.pendingBytes = 0;

    const writable = this.writable;
    await observeInstallTask("opfs.write", () => writable.write(bytes), { pack: this.currentPack?.name, bytes: bytes.byteLength, packBytes: this.currentPack?.size });
  }
}

class ZipStreamReader {
  private readonly reader: ReadableStreamDefaultReader<ByteChunk>;
  private buffer: ByteChunk = new Uint8Array(0);
  private done = false;
  private downloadedBytes = 0;

  get offset(): number {
    return this.downloadedBytes - this.buffer.byteLength;
  }

  constructor(
    private readonly playKey: string,
    body: ReadableStream<ByteChunk>,
    private readonly onDownload: (downloadedBytes: number) => void,
  ) {
    this.reader = body.getReader();
  }

  async readNextEntry(): Promise<LocalZipEntry | null> {
    const hasSignature = await this.ensure(4, true);

    if (!hasSignature && this.buffer.byteLength === 0) {
      return null;
    }

    if (this.buffer.byteLength < 4) {
      throw new Error("ZIP 文件不完整（文件头被截断）。");
    }

    const signature = readUint32(this.buffer, 0);

    if (
      signature === centralDirectorySignature ||
      signature === endOfCentralDirectorySignature
    ) {
      return null;
    }

    if (signature !== localFileHeaderSignature) {
      throw new Error(`ZIP 文件头损坏：0x${signature.toString(16)}`);
    }

    const fixed = await this.readBytes(30);
    const flags = readUint16(fixed, 6);
    const compression = readUint16(fixed, 8);
    const crc32 = readUint32(fixed, 14);
    const compressedSize = readUint32(fixed, 18);
    const uncompressedSize = readUint32(fixed, 22);
    const nameLength = readUint16(fixed, 26);
    const extraLength = readUint16(fixed, 28);

    if ((flags & zipDataDescriptorFlag) !== 0) {
      throw new Error("ZIP 使用了暂不支持的格式，无法边下载边安装。");
    }

    const nameBytes = await this.readBytes(nameLength);
    const name = decodeZipPath(this.playKey, nameBytes, flags);

    await this.discardBytes(extraLength);

    return {
      name,
      flags,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
    };
  }

  async discardBytes(length: number): Promise<void> {
    await this.pipeBytes(length, async () => undefined);
  }

  async drainToEnd(): Promise<void> {
    this.consume(this.buffer.byteLength);

    while (!this.done) {
      await this.readChunk();
      this.consume(this.buffer.byteLength);
    }
  }

  async pipeBytes(
    length: number,
    onChunk: (chunk: ByteChunk) => Promise<void>,
  ): Promise<void> {
    let remaining = length;

    while (remaining > 0) {
      if (this.buffer.byteLength === 0) {
        await this.readChunk();
      }

      if (this.buffer.byteLength === 0) {
        throw new Error("ZIP 内的文件不完整。");
      }

      const take = Math.min(remaining, this.buffer.byteLength);
      const chunk = this.buffer.subarray(0, take);

      await onChunk(chunk);
      this.consume(take);
      remaining -= take;
    }
  }

  private async readBytes(length: number): Promise<ByteChunk> {
    await this.ensure(length);

    const bytes = this.buffer.slice(0, length);

    this.consume(length);

    return bytes;
  }

  private async ensure(length: number, allowEof = false): Promise<boolean> {
    while (this.buffer.byteLength < length && !this.done) {
      await this.readChunk();
    }

    if (this.buffer.byteLength < length) {
      if (allowEof) {
        return false;
      }

      throw new Error("ZIP 文件不完整。");
    }

    return true;
  }

  private async readChunk(): Promise<void> {
    if (this.done) {
      return;
    }

    const result = await observeInstallTask("network.read", () => this.reader.read(), { downloadedBytes: this.downloadedBytes, bufferedBytes: this.buffer.byteLength, offset: this.offset });

    if (result.done) {
      this.done = true;
      return;
    }

    this.downloadedBytes += result.value.byteLength;
    this.onDownload(this.downloadedBytes);
    this.buffer = appendChunk(this.buffer, result.value);
  }

  private consume(length: number): void {
    this.buffer =
      length >= this.buffer.byteLength ? new Uint8Array(0) : this.buffer.subarray(length);
  }
}

function createInitialInstallation(metadata: WebPlayMetadata): WebPlayInstallation {
  const now = new Date().toISOString();

  return {
    workId: metadata.workId,
    playKey: metadata.playKey,
    archiveVersionId: metadata.archiveVersionId,
    manifestSha256: metadata.manifestSha256,
    webPlayInstallerVersion: metadata.webPlayInstallerVersion,
    title: metadata.title,
    originalTitle: metadata.originalTitle,
    engineFamily: metadata.engineFamily,
    coverBlobSha256: metadata.coverBlobSha256,
    status: "created",
    phase: "metadata",
    createdAt: now,
    updatedAt: now,
    readyAt: null,
    lastPlayedAt: null,
    totalFiles: metadata.installTotalFiles,
    totalSizeBytes: metadata.installTotalSizeBytes,
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

async function saveFileRecordsInBatches(
  records: WebPlayFileRecord[],
): Promise<void> {
  for (let offset = 0; offset < records.length; offset += fileRecordBatchSize) {
    const batch = records.slice(offset, offset + fileRecordBatchSize);
    await observeInstallTask("idb.file-records", () => saveWebPlayFileRecords(batch), { offset, count: batch.length });
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
  await observeInstallTask("idb.installation", () => saveWebPlayInstallation(installation), { phase: installation.phase, status: installation.status, downloadedBytes: installation.downloadedBytes });
  if (installation.status === "ready") await observeInstallTask("storage.renew-bucket", () => renewGameBucket(installation));
  installObserver?.event("installation", { ...installation });
  postMessage({
    type: "installation",
    installation,
  } satisfies WebPlayInstallWorkerOutput);

  return installation;
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
    throw new Error(`ZIP 中存在非法路径：${path}`);
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .join("/");
}

function packLookupKey(path: string): string {
  return path.toLowerCase();
}

function assertNotCanceled(playKey: string): void {
  if (canceledPlayKeys.has(playKey)) {
    throw new Error("安装已取消。");
  }
}

function isRetryableInstallError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "安装已取消。") {
    return false;
  }

  if (/下载 ZIP 失败：HTTP (408|429|5\d\d)/.test(message)) {
    return true;
  }

  if (
    message.includes("ZIP 文件不完整") ||
    message.includes("ZIP 内的文件不完整")
  ) {
    return true;
  }

  const lower = message.toLowerCase();

  return [
    "network error",
    "failed to fetch",
    "load failed",
    "networkerror",
    "the network connection was lost",
    "connection closed",
    "connection reset",
    "err_http2",
    "err_quic",
    "http2 protocol error",
  ].some((pattern) => lower.includes(pattern));
}

function retryDelayMs(attempt: number): number {
  return retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
}

async function delay(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function numberHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : null;
}

function appendChunk(left: ByteChunk, right: ByteChunk): ByteChunk {
  if (left.byteLength === 0) {
    return right;
  }

  const result = new Uint8Array(left.byteLength + right.byteLength);

  result.set(left, 0);
  result.set(right, left.byteLength);

  return result;
}

function streamBytes(bytes: ByteChunk): ReadableStream<ByteChunk> {
  return new ReadableStream<ByteChunk>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function coalesceChunks(
  chunks: ByteChunk[],
  totalBytes: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function formatDuration(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs <= 0) {
    return "0ms";
  }

  if (valueMs < 1000) {
    return `${Math.round(valueMs)}ms`;
  }

  return `${(valueMs / 1000).toFixed(2)}s`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  let next = value;

  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (next < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.round(next)} B` : `${next.toFixed(2)} ${unit}`;
    }

    next /= 1024;
  }

  return `${value} B`;
}

function decodeZipPath(playKey: string, bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0) {
    postLog(
      playKey,
      "warning",
      "部分游戏文件名无法识别；如在线游玩出现问题，请下载 ZIP。",
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
