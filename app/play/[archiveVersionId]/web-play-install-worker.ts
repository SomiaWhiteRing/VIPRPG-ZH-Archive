/// <reference lib="webworker" />

import {
  clearWebPlayFileRecords,
  saveWebPlayFileRecords,
  saveWebPlayInstallation,
} from "@/app/play/[archiveVersionId]/web-play-db";
import {
  createGamePackWritable,
  ensureOpfsSupported,
  resetGameOpfsDirectory,
  writeGameIndexJson,
  writeGamePackIndexJson,
} from "@/app/play/[archiveVersionId]/web-play-opfs";
import type {
  WebPlayFileRecord,
  WebPlayInstallation,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
} from "@/app/play/[archiveVersionId]/web-play-types";
import { contentTypeForArchivePath } from "@/lib/archive/file-policy";
import { shouldSkipWebPlayLocalWrite } from "@/lib/archive/web-play-local-policy";

type EasyRpgCacheNode = {
  _dirname?: string;
  [name: string]: string | EasyRpgCacheNode | undefined;
};

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
  downloadZipBuilderVersion: string;
  webPlayInstallerVersion: string;
  easyRpgRuntimeVersion: string;
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
const fileRecordBatchSize = 1000;
const packTargetSizeBytes = 256 * 1024 * 1024;
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
        updatedAt: new Date().toISOString(),
      },
      true,
    );

    const result = await streamZipToPacks({
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
          version: 3,
          storage: "pack-index",
          archiveVersionId: metadata.archiveVersionId,
          manifestSha256: metadata.manifestSha256,
        },
      }),
    );
    await writeGamePackIndexJson(metadata.playKey, JSON.stringify(result.packIndex));

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
      `浏览器本地安装完成，资源写入 ${result.packIndex.packs.length.toLocaleString(
        "zh-CN",
      )} 个 pack 文件。`,
    );
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

async function streamZipToPacks(input: {
  metadata: WebPlayMetadata;
  response: Response;
  installation: WebPlayInstallation;
  indexRoot: EasyRpgCacheNode;
}): Promise<{ installation: WebPlayInstallation; packIndex: WebPlayPackIndex }> {
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
  let skippedLocalFiles = 0;
  let skippedLocalBytes = 0;
  let lastProgressAt = 0;
  let progressWrite = Promise.resolve();
  const fileRecords: WebPlayFileRecord[] = [];
  const packWriter = new PackWriter(input.metadata.playKey);
  const packIndex: WebPlayPackIndex = {
    version: 1,
    archiveVersionId: input.metadata.archiveVersionId,
    manifestSha256: input.metadata.manifestSha256,
    downloadZipBuilderVersion: input.metadata.downloadZipBuilderVersion,
    webPlayInstallerVersion: input.metadata.webPlayInstallerVersion,
    easyRpgRuntimeVersion: input.metadata.easyRpgRuntimeVersion,
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

    progressWrite = progressWrite.then(async () => {
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
    });
  };

  let body: ReadableStream<ByteChunk> | null = input.response.body;

  if (!body) {
    const bytes = new Uint8Array(await input.response.arrayBuffer());
    downloadedBytes = bytes.byteLength;
    queueProgress(true);
    body = streamBytes(bytes);
  }

  if (!body) {
    throw new Error("浏览器未提供 ZIP 响应流。");
  }

  const reader = new ZipStreamReader(input.metadata.playKey, body, (bytes) => {
    downloadedBytes = bytes;
    queueProgress();
  });

  postLog(
    input.metadata.playKey,
    "info",
    "使用 ZIP local header 顺序解析，并写入 OPFS pack。",
  );

  try {
    while (true) {
      assertNotCanceled(input.metadata.playKey);
      const entry = await reader.readNextEntry();

      if (!entry) {
        await reader.drainToEnd();
        break;
      }

      const normalizedPath = normalizeZipEntryPath(entry.name);

      if (entry.compression !== zipMethodStore) {
        throw new Error(`当前安装器只支持 store ZIP entry：${normalizedPath ?? entry.name}`);
      }

      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new Error(`ZIP entry 大小异常：${normalizedPath ?? entry.name}`);
      }

      if (!normalizedPath) {
        await reader.discardBytes(entry.compressedSize);
        continue;
      }

      if (shouldSkipWebPlayLocalWrite(normalizedPath)) {
        skippedLocalFiles += 1;
        skippedLocalBytes += entry.uncompressedSize;
        await reader.discardBytes(entry.compressedSize);
        continue;
      }

      addToEasyRpgIndex(input.indexRoot, normalizedPath);
      const location = await packWriter.beginEntry(entry.uncompressedSize);
      const lookupKey = packLookupKey(normalizedPath);

      if (packIndex.files[lookupKey]) {
        throw new Error(`Web Play pack 路径冲突：${normalizedPath}`);
      }

      await reader.pipeBytes(entry.compressedSize, async (chunk) => {
        await packWriter.write(chunk);
      });

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
      currentPath = normalizedPath;
      queueProgress();
    }
  } finally {
    await packWriter.close();
  }

  if (skippedLocalFiles > 0) {
    postLog(
      input.metadata.playKey,
      "info",
      `本地写入跳过 ${skippedLocalFiles.toLocaleString(
        "zh-CN",
      )} 个 TXT / EXE / DLL 文件，约 ${formatBytes(skippedLocalBytes)}。`,
    );
  }

  queueProgress(true);
  await progressWrite;
  await saveFileRecordsInBatches(fileRecords);

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
  private nextPackIndex = 0;

  constructor(private readonly playKey: string) {}

  async beginEntry(length: number): Promise<PackEntryLocation> {
    if (
      !this.currentPack ||
      (this.currentPack.size > 0 &&
        this.currentPack.size + length > packTargetSizeBytes)
    ) {
      await this.rotatePack();
    }

    if (!this.currentPack) {
      throw new Error("Pack writer is not open");
    }

    return {
      pack: this.currentPack.name,
      offset: this.currentPack.size,
    };
  }

  async write(chunk: ByteChunk): Promise<void> {
    if (!this.writable || !this.currentPack) {
      throw new Error("Pack writer is not open");
    }

    await this.writable.write(toWriteBuffer(chunk));
    this.currentPack.size += chunk.byteLength;
  }

  async close(): Promise<void> {
    if (!this.writable) {
      return;
    }

    const writable = this.writable;

    this.writable = null;
    this.currentPack = null;
    await writable.close();
  }

  private async rotatePack(): Promise<void> {
    await this.close();

    const name = `assets-${String(this.nextPackIndex).padStart(3, "0")}.pack`;

    this.nextPackIndex += 1;
    this.currentPack = { name, size: 0 };
    this.packs.push(this.currentPack);
    this.writable = await createGamePackWritable(this.playKey, name);
  }
}

class ZipStreamReader {
  private readonly reader: ReadableStreamDefaultReader<ByteChunk>;
  private buffer: ByteChunk = new Uint8Array(0);
  private done = false;
  private downloadedBytes = 0;

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
      throw new Error("ZIP 数据在文件头处截断。");
    }

    const signature = readUint32(this.buffer, 0);

    if (
      signature === centralDirectorySignature ||
      signature === endOfCentralDirectorySignature
    ) {
      return null;
    }

    if (signature !== localFileHeaderSignature) {
      throw new Error(`ZIP local header 损坏：0x${signature.toString(16)}`);
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
      throw new Error("ZIP entry 使用 data descriptor，无法边下载边定位 entry。");
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
        throw new Error("ZIP entry 数据被截断。");
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

      throw new Error("ZIP 数据被截断。");
    }

    return true;
  }

  private async readChunk(): Promise<void> {
    if (this.done) {
      return;
    }

    const result = await this.reader.read();

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

function packLookupKey(path: string): string {
  return path.toLowerCase();
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

function toWriteBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }

  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy;
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

function decodeZipPath(playKey: string, bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0) {
    postLog(
      playKey,
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
