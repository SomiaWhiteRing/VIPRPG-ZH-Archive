import { Crc32 } from "@/lib/archive/crc32";
import { zipSync, type Zippable } from "fflate";

export type SaveFile = {
  name: string;
  bytes: Uint8Array;
  timestamp?: Date;
  /** Original IDBFS key: preserve its spelling when replacing an existing slot. */
  sourcePath?: string;
};

const maxFiles = 100;
const maxSaveBytes = 16 * 1024 * 1024;
const maxTotalBytes = 40 * 1024 * 1024;
const signature = new TextEncoder().encode("LcfSaveData");
const changedMessage = "本地存档已变化，请重新导入并确认。";
const zipStructureMessage = "ZIP 结构不受支持，请使用根目录仅包含 SaveNN.lsd 的 ZIP。";

function saveName(name: string, allowDownloadSuffix = false): string | null {
  const match = (allowDownloadSuffix
    ? /^Save([0-9]{2,6})(?: \([0-9]+\))?\.lsd$/i
    : /^Save([0-9]{2,6})\.lsd$/i).exec(name);
  return match ? `Save${match[1]}.lsd` : null;
}

function validateSave(file: SaveFile): void {
  if (!saveName(file.name)) throw new Error("请选择 Save01.lsd 这类存档文件，保留原始槽位编号。");
  if (file.bytes.byteLength > maxSaveBytes) throw new Error(`单个存档不能超过 16 MiB：${file.name}`);
  if (file.bytes.length < signature.length + 1 || file.bytes[0] !== signature.length
    || signature.some((byte, index) => file.bytes[index + 1] !== byte)) {
    throw new Error(`不是有效的 LSD 存档：${file.name}`);
  }
}

function validateIncoming(files: SaveFile[]): void {
  if (!files.length || files.length > maxFiles) throw new Error("每次最多导入 100 个存档，请至少选择一个存档。");
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    validateSave(file);
    const name = saveName(file.name)!;
    if (names.has(name)) throw new Error(`导入来源包含重复槽位：${name}，请分批导入。`);
    names.add(name);
    total += file.bytes.length;
    if (total > maxTotalBytes) throw new Error("本次解压后的存档总量超过 40 MiB。");
  }
}

export async function parseSaveImports(files: File[], signal: AbortSignal): Promise<SaveFile[]> {
  signal.throwIfAborted();
  if (!files.length || files.length > maxFiles) throw new Error("每次请选择 1 至 100 个 LSD 或 ZIP 文件。");
  const incoming: SaveFile[] = [];
  const names = new Set<string>();
  let total = 0;
  const add = (file: SaveFile) => {
    validateSave(file);
    if (names.has(file.name)) throw new Error(`导入来源包含重复槽位：${file.name}，请分批导入。`);
    if (incoming.length >= maxFiles) throw new Error("每次最多导入 100 个存档。");
    total += file.bytes.length;
    if (total > maxTotalBytes) throw new Error("本次解压后的存档总量超过 40 MiB。");
    names.add(file.name);
    incoming.push(file);
  };
  for (const file of files) {
    signal.throwIfAborted();
    const zipped = /\.zip$/i.test(file.name);
    const name = zipped ? null : saveName(file.name, true);
    if (!zipped && !name) throw new Error("请选择 Save01.lsd 这类存档文件，保留原始槽位编号。");
    if (file.size > (zipped ? maxTotalBytes : maxSaveBytes)) {
      throw new Error(zipped ? "单个 ZIP 文件不能超过 40 MiB。" : "单个存档不能超过 16 MiB。");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    if (bytes.length !== file.size) throw new Error("读取文件失败，请重新选择文件。");
    if (zipped) {
      const entries = readZipDirectory(bytes);
      for (const entry of entries) {
        if (names.has(entry.name)) throw new Error(`导入来源包含重复槽位：${entry.name}，请分批导入。`);
        if (incoming.length >= maxFiles) throw new Error("每次最多导入 100 个存档。");
        const remaining = Math.min(maxSaveBytes, maxTotalBytes - total);
        const contents = await inflateZipEntry(bytes, entry, remaining, signal);
        add({ name: entry.name, bytes: contents, timestamp: entry.timestamp });
      }
    } else {
      add({ name: name!, bytes, timestamp: new Date(file.lastModified) });
    }
  }
  signal.throwIfAborted();
  return incoming.sort((a, b) => a.name.localeCompare(b.name));
}

type ZipEntry = {
  name: string;
  rawName: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  size: number;
  compressedSize: number;
  offset: number;
  dataOffset: number;
  timestamp?: Date;
};

/** Validate both ZIP indexes before decoding any payload; no filenames become paths. */
function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bounds = (offset: number, length: number, end = bytes.length) => {
    if (offset < 0 || length < 0 || offset + length > end) throw new Error("ZIP 文件不完整或已损坏。");
  };
  const u16 = (offset: number) => { bounds(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset: number) => { bounds(offset, 4); return view.getUint32(offset, true); };
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP 文件不完整或已损坏。");
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryOffset = u32(end + 16);
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count) {
    throw new Error("不支持多磁盘 ZIP 文件。");
  }
  if (!count) throw new Error("ZIP 中没有可导入的 LSD 存档。");
  if (count > maxFiles) throw new Error("每次最多导入 100 个存档。");
  if (directoryOffset + directorySize !== end) throw new Error("ZIP 文件不完整或使用了不支持的 ZIP64 格式。");
  bounds(directoryOffset, directorySize, end);
  const extra = (offset: number, length: number) => {
    const extraEnd = offset + length;
    bounds(offset, length);
    while (offset < extraEnd) {
      bounds(offset, 4, extraEnd);
      const tag = u16(offset);
      const size = u16(offset + 2);
      bounds(offset + 4, size, extraEnd);
      // ZIP64, AES and alternate Unicode paths can change the interpretation.
      if (tag === 0x0001 || tag === 0x9901 || tag === 0x7075) throw new Error(zipStructureMessage);
      offset += 4 + size;
    }
  };
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    bounds(cursor, 46, end);
    if (u32(cursor) !== 0x02014b50) throw new Error("ZIP 中央目录已损坏。");
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const attributes = u32(cursor + 38);
    const mode = (attributes >>> 16) & 0o170000;
    if ((flags & ~0x080e) !== 0) throw new Error("不支持加密或特殊编码的 ZIP 文件。");
    if (u16(cursor + 6) > 20 || (method !== 0 && method !== 8) || u16(cursor + 34) !== 0) {
      throw new Error("不支持此 ZIP 压缩格式或多磁盘 ZIP 文件。");
    }
    if ((attributes & 0x10) || (mode && mode !== 0o100000)) throw new Error(zipStructureMessage);
    bounds(cursor + 46, nameLength + extraLength + commentLength, end);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (rawName.some(byte => byte > 0x7f)) throw new Error(zipStructureMessage);
    const name = saveName(String.fromCharCode(...rawName));
    if (!name) throw new Error(zipStructureMessage);
    if (names.has(name)) throw new Error(`导入来源包含重复槽位：${name}，请分批导入。`);
    names.add(name);
    const size = u32(cursor + 24);
    total += size;
    if (size > maxSaveBytes) throw new Error(`单个存档不能超过 16 MiB：${name}`);
    if (total > maxTotalBytes) throw new Error("本次解压后的存档总量超过 40 MiB。");
    extra(cursor + 46 + nameLength, extraLength);
    const date = u16(cursor + 14);
    const time = u16(cursor + 12);
    const timestamp = date ? new Date(1980 + (date >>> 9), ((date >>> 5) & 15) - 1, date & 31,
      time >>> 11, (time >>> 5) & 63, (time & 31) * 2) : undefined;
    entries.push({ name, rawName, flags, method, crc: u32(cursor + 16), size,
      compressedSize: u32(cursor + 20), offset: u32(cursor + 42), dataOffset: 0, timestamp });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new Error("ZIP 中央目录已损坏。");
  // Require every local entry to be indexed exactly once, with no hidden records,
  // SFX prefix, overlap, trailing payload, or directory traversal entries.
  entries.sort((a, b) => a.offset - b.offset);
  let expectedOffset = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const nextOffset = entries[index + 1]?.offset ?? directoryOffset;
    const offset = entry.offset;
    if (offset !== expectedOffset) throw new Error(zipStructureMessage);
    bounds(offset, 30, nextOffset);
    if (u32(offset) !== 0x04034b50 || u16(offset + 4) > 20
      || u16(offset + 6) !== entry.flags || u16(offset + 8) !== entry.method) throw new Error("ZIP 文件头与中央目录不一致。");
    const nameLength = u16(offset + 26);
    const extraLength = u16(offset + 28);
    bounds(offset + 30, nameLength + extraLength, nextOffset);
    const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
    if (!sameBytes(localName, entry.rawName)) throw new Error("ZIP 文件名不一致。");
    extra(offset + 30 + nameLength, extraLength);
    entry.dataOffset = offset + 30 + nameLength + extraLength;
    bounds(entry.dataOffset, entry.compressedSize, nextOffset);
    const descriptor = (entry.flags & 8) !== 0;
    for (const [field, expected] of [[14, entry.crc], [18, entry.compressedSize], [22, entry.size]]) {
      const value = u32(offset + field);
      if (value !== expected && !(descriptor && value === 0)) throw new Error("ZIP 文件尺寸或校验信息不一致。");
    }
    let dataEnd = entry.dataOffset + entry.compressedSize;
    if (descriptor) {
      const length = nextOffset - dataEnd;
      if (length === 16 && u32(dataEnd) === 0x08074b50) dataEnd += 4;
      else if (length !== 12) throw new Error("ZIP 数据描述符已损坏。");
      if (u32(dataEnd) !== entry.crc || u32(dataEnd + 4) !== entry.compressedSize || u32(dataEnd + 8) !== entry.size) {
        throw new Error("ZIP 数据描述符校验失败。");
      }
      dataEnd += 12;
    }
    if (dataEnd !== nextOffset) throw new Error(zipStructureMessage);
    expectedOffset = nextOffset;
  }
  return entries;
}

async function inflateZipEntry(archive: Uint8Array, entry: ZipEntry, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (entry.size > limit) throw new Error("本次解压后的存档总量超过 40 MiB。");
  const compressed = archive.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  const checksum = new Crc32();
  let bytes: Uint8Array;
  if (entry.method === 0) {
    if (compressed.length > limit) throw new Error("存档解压大小超过安全限制。");
    bytes = compressed.slice();
    checksum.update(bytes);
  } else {
    let decoder: DecompressionStream;
    try {
      decoder = new DecompressionStream("deflate-raw");
    } catch {
      throw new Error("当前浏览器不支持 ZIP 解压，请更新浏览器，或先解压后选择 LSD 文件。");
    }
    let offset = 0;
    // Feed bounded compressed chunks, and apply backpressure while counting real
    // output. Never allocate from the ZIP's untrusted uncompressed-size field.
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (offset >= compressed.length) { controller.close(); return; }
        const end = Math.min(offset + 1024, compressed.length);
        controller.enqueue(new Uint8Array(compressed.subarray(offset, end)));
        offset = end;
      },
    });
    const reader = source.pipeThrough(decoder).getReader();
    const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const result = await reader.read();
        signal.throwIfAborted();
        if (result.done) break;
        size += result.value.length;
        if (size > limit || size > entry.size) throw new Error("ZIP 实际解压大小超过安全限制或与文件头不符。");
        checksum.update(result.value);
        chunks.push(result.value);
      }
      bytes = new Uint8Array(size);
      let position = 0;
      for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      signal.throwIfAborted();
      if (error instanceof Error && error.message.startsWith("ZIP 实际")) throw error;
      throw new Error("ZIP 解压失败，文件可能不完整或已损坏。");
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  }
  signal.throwIfAborted();
  if (bytes.length !== entry.size || checksum.digest() !== entry.crc) throw new Error(`ZIP 存档校验失败：${entry.name}`);
  return bytes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function saveDirectory(workId: number): string {
  if (!Number.isSafeInteger(workId) || workId <= 0) throw new Error("作品编号无效。");
  return `/work-saves/${workId}`;
}

function fileNameAtKey(directory: string, key: IDBValidKey): string | null {
  return typeof key === "string" && key.startsWith(`${directory}/`) ? saveName(key.slice(directory.length + 1)) : null;
}

function fileAtCursor(directory: string, cursor: IDBCursorWithValue): SaveFile | null {
  const name = fileNameAtKey(directory, cursor.key);
  if (!name) return null;
  const entry = cursor.value as { mode?: number; contents?: Uint8Array; timestamp?: Date } | null;
  if (!entry || typeof entry.mode !== "number" || (entry.mode & 0o170000) !== 0o100000 || !(entry.contents instanceof Uint8Array)) {
    throw new Error(`本地存档格式异常：${name}，请先检查浏览器存储。`);
  }
  return { name, bytes: entry.contents, sourcePath: String(cursor.key),
    timestamp: entry.timestamp instanceof Date && Number.isFinite(entry.timestamp.getTime()) ? entry.timestamp : undefined };
}

async function openExistingDatabase(directory: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    // IDBFS owns its schema version. Aborting creation keeps reads side-effect free.
    const request = indexedDB.open(directory);
    let missing = false;
    let blocked = false;
    request.onupgradeneeded = () => { missing = true; request.transaction!.abort(); };
    request.onblocked = () => { blocked = true; reject(new Error("本地存档正在被其他页面使用，请关闭其他游戏页面后重试。")); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
  });
}

export async function hasSaveFiles(workId: number): Promise<boolean> {
  const directory = saveDirectory(workId);
  const db = await openExistingDatabase(directory);
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let found = false;
      const tx = db.transaction("FILE_DATA", "readonly");
      // Poll names only; do not deserialize every save's contents on the timer.
      const request = tx.objectStore("FILE_DATA").openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (fileNameAtKey(directory, cursor.key)) found = true;
        else cursor.continue();
      };
      tx.oncomplete = () => resolve(found);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally { db.close(); }
}

export async function readSaveFiles(workId: number): Promise<SaveFile[]> {
  const directory = saveDirectory(workId);
  const db = await openExistingDatabase(directory);
  if (!db) return [];
  try {
    return await new Promise<SaveFile[]>((resolve, reject) => {
      const files: SaveFile[] = [];
      const names = new Set<string>();
      let failure: unknown;
      const tx = db.transaction("FILE_DATA", "readonly");
      const request = tx.objectStore("FILE_DATA").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          const file = fileAtCursor(directory, cursor);
          if (file) {
            if (names.has(file.name)) throw new Error(`本地存在大小写重复槽位：${file.name}，请先整理存档后重试。`);
            names.add(file.name);
            files.push(file);
          }
          cursor.continue();
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(files.sort((a, b) => a.name.localeCompare(b.name)));
      tx.onabort = () => reject(failure ?? tx.error ?? request.error);
    });
  } finally { db.close(); }
}

/** Caller holds the game's exclusive Web Lock and has obtained import consent. */
export async function importSaveFiles(
  workId: number,
  incoming: SaveFile[],
  existingSnapshot: SaveFile[],
  overwrite: Set<string>,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  validateIncoming(incoming);
  const directory = saveDirectory(workId);
  const snapshot = new Map(existingSnapshot.map(file => [file.name, file]));
  if (snapshot.size !== existingSnapshot.length) throw new Error(changedMessage);
  return new Promise<number>((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let upgrading = false;
    let committed = false;
    let settled = false;
    let imported = 0;
    let failure: unknown;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      db?.close();
      if (error !== undefined) reject(error);
      else resolve(imported);
    };
    const abort = () => {
      if (committed) return;
      failure = signal.reason ?? new DOMException("已取消导入。", "AbortError");
      if (tx) {
        try { tx.abort(); } catch { /* Completion may already be queued. */ }
      } else finish(failure);
    };
    const write = (transaction: IDBTransaction) => {
      tx = transaction;
      const store = transaction.objectStore("FILE_DATA");
      const current = new Map<string, SaveFile>();
      const request = store.openCursor();
      request.onsuccess = () => {
        try {
          signal.throwIfAborted();
          const cursor = request.result;
          if (cursor) {
            const file = fileAtCursor(directory, cursor);
            if (file) {
              if (current.has(file.name)) throw new Error(changedMessage);
              current.set(file.name, file);
            }
            cursor.continue();
            return;
          }
          // Validate the complete reviewed snapshot inside this write transaction.
          // Another tab's save between the dialog and commit never gets overwritten.
          if (current.size !== snapshot.size) throw new Error(changedMessage);
          for (const [name, file] of current) {
            const previous = snapshot.get(name);
            if (!previous || file.sourcePath !== (previous.sourcePath ?? `${directory}/${previous.name}`)
              || !sameBytes(file.bytes, previous.bytes)) throw new Error(changedMessage);
          }
          for (const file of incoming) {
            const name = saveName(file.name)!;
            const existing = current.get(name);
            if (existing && !overwrite.has(name)) continue;
            const path = existing?.sourcePath ?? `${directory}/${name}`;
            store.put({ timestamp: new Date(), mode: 0o100666, contents: file.bytes }, path);
            imported++;
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.onabort = () => finish(failure ?? transaction.error ?? new Error("导入存档失败。"));
      transaction.oncomplete = () => {
        committed = true;
        if (!upgrading) finish();
      };
    };
    signal.addEventListener("abort", abort, { once: true });
    // Open with no fixed version. For a brand-new database, create the IDBFS
    // schema AND write saves in the upgrade transaction so cancellation rolls
    // back everything, including database creation.
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(directory); } catch (error) { finish(error); return; }
    request.onupgradeneeded = () => {
      db = request.result;
      if (settled || signal.aborted) { request.transaction!.abort(); return; }
      try {
        upgrading = true;
        const store = db.createObjectStore("FILE_DATA");
        store.createIndex("timestamp", "timestamp", { unique: false });
        write(request.transaction!);
      } catch (error) {
        failure = error;
        request.transaction!.abort();
      }
    };
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => db?.close();
      if (settled) { db.close(); return; }
      if (upgrading) { finish(); return; }
      if (signal.aborted) { abort(); return; }
      try { write(db.transaction("FILE_DATA", "readwrite")); } catch (error) { finish(error); }
    };
    request.onerror = () => finish(failure ?? request.error ?? new Error("无法打开本地存档。"));
    request.onblocked = () => finish(new Error("本地存档正在被其他页面使用，请关闭其他游戏页面后重试。"));
  });
}

export function saveArchiveFilename(title: string, workId: number): string {
  const suffix = "_Saves.zip";
  let name = (title ?? "").normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim().replace(/[.\s]+$/g, "");
  if (!name) name = `game-${workId}`;
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(\.|$)/i.test(name)) name = `_${name}`;
  const encoder = new TextEncoder();
  let limited = "";
  let length = suffix.length;
  let bytes = encoder.encode(suffix).length;
  for (let character of name) {
    // TextEncoder replaces lone surrogates. Keep the actual filename identical.
    if (character.length === 1 && /[\uD800-\uDFFF]/u.test(character)) character = "\uFFFD";
    const size = encoder.encode(character).length;
    if (length + character.length > 180 || bytes + size > 240) break;
    limited += character;
    length += character.length;
    bytes += size;
  }
  return `${limited.replace(/[.\s]+$/g, "") || `game-${workId}`}${suffix}`;
}

export function saveArchiveBlob(files: SaveFile[]): Blob {
  if (!files.length) throw new Error("请选择要导出的存档。");
  const entries: Zippable = Object.create(null) as Zippable;
  for (const file of files) {
    const name = saveName(file.name);
    if (!name || Object.hasOwn(entries, name)) throw new Error("存档槽位无效或重复，无法导出。");
    entries[name] = file.timestamp && Number.isFinite(file.timestamp.getTime())
      && file.timestamp.getFullYear() >= 1980 && file.timestamp.getFullYear() <= 2107
      ? [file.bytes, { mtime: file.timestamp }] : file.bytes;
  }
  return new Blob([new Uint8Array(zipSync(entries))], { type: "application/zip" });
}
