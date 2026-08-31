import { inflate } from "fflate";
import {
  contentTypeForArchivePath,
  normalizeArchivePath,
} from "@/lib/archive/file-policy";
import type {
  UploadSourceFile,
  UploadSourceKind,
} from "@/app/upload/upload-types";

export type UploadSourceEntry = {
  path: string;
  size: number;
  mtimeMs: number | null;
  contentType: string;
  bytes: () => Promise<Uint8Array>;
};

export type UploadSourcePrefill = {
  gameTitle: string | null;
  titleImages: File[];
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

type LegacyZipEncoding = "utf-8" | "shift_jis" | "gb18030";

const utf8TextDecoder = new TextDecoder("utf-8");
const fatalUtf8TextDecoder = new TextDecoder("utf-8", { fatal: true });
const shiftJisTextDecoder = new TextDecoder("shift_jis");
const gb18030TextDecoder = new TextDecoder("gb18030");
const latinTextDecoder = new TextDecoder("windows-1252");
const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zipUtf8Flag = 0x0800;
const zipMethodStore = 0;
const zipMethodDeflate = 8;
const zipEncryptedFlag = 0x0001;

export async function enumerateUploadSourceFiles(
  files: UploadSourceFile[],
  sourceKind: UploadSourceKind,
): Promise<UploadSourceEntry[]> {
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
    .sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    );
}

export async function inspectUploadSource(
  files: UploadSourceFile[],
  sourceKind: UploadSourceKind,
): Promise<UploadSourcePrefill> {
  const entries = await enumerateUploadSourceFiles(files, sourceKind);
  const ini = entries.find((entry) => entry.path.toLowerCase() === "rpg_rt.ini");
  const titleEntries = entries
    .filter(isTitleImage)
    .sort(
      (left, right) =>
        (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0) ||
        left.path.localeCompare(right.path),
    );

  const titleImages = await Promise.all(
    titleEntries.map(async (entry) => {
      const contentType = entry.contentType.split(";", 1)[0] || "image/png";
      return new File([toArrayBuffer(await entry.bytes())], basename(entry.path), {
        lastModified: entry.mtimeMs ?? 0,
        type: contentType,
      });
    }),
  );

  return {
    gameTitle: ini ? parseGameTitle(await ini.bytes()) : null,
    titleImages,
  };
}

function isTitleImage(entry: UploadSourceEntry): boolean {
  const parts = normalizeArchivePath(entry.path).split("/").filter(Boolean);
  return (
    parts.length >= 2 &&
    parts[0].toLowerCase() === "title" &&
    entry.contentType.toLowerCase().startsWith("image/")
  );
}

function parseGameTitle(bytes: Uint8Array): string | null {
  const text = decodeRpgRtIni(bytes);
  let inRpgRt = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inRpgRt = section[1].trim().toLowerCase() === "rpg_rt";
      continue;
    }
    if (!inRpgRt || !line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "gametitle") continue;
    return line.slice(separator + 1).trim() || null;
  }

  return null;
}

function decodeRpgRtIni(bytes: Uint8Array): string {
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return utf8TextDecoder.decode(bytes.subarray(3));
  }

  const declaredEncoding = latinTextDecoder
    .decode(bytes)
    .match(/^\s*Encoding\s*=\s*(932|936)\s*$/im)?.[1];
  if (declaredEncoding === "936") return gb18030TextDecoder.decode(bytes);
  if (declaredEncoding === "932") return shiftJisTextDecoder.decode(bytes);

  const utf8 = tryDecodeUtf8(bytes);
  if (utf8 !== null) return utf8;

  const candidates = [
    shiftJisTextDecoder.decode(bytes),
    gb18030TextDecoder.decode(bytes),
  ];
  return candidates.sort((left, right) => scoreIni(right) - scoreIni(left))[0];
}

function scoreIni(value: string): number {
  let score = /\[RPG_RT\]/i.test(value) ? 100 : 0;
  score += /^\s*GameTitle\s*=/im.test(value) ? 100 : 0;

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\uFFFD") {
      score -= 100;
    } else if (isHiragana(code) || isKatakana(code)) {
      score += 4;
    } else if (isCjk(code)) {
      score += 1;
    }
  }

  return score;
}

async function enumerateZipSourceFiles(
  files: UploadSourceFile[],
): Promise<UploadSourceEntry[]> {
  const zipFile = files[0]?.file;
  if (!zipFile) throw new Error("未选择 ZIP 文件");

  const entries = await readZipCentralDirectory(zipFile);
  const gameRoot = findZipGameRoot(entries);
  return entries
    .flatMap((entry): UploadSourceEntry[] => {
      const path = pathWithinZipGameRoot(entry.normalizedPath, gameRoot);
      if (path === null) return [];

      return [
        {
          path,
          size: entry.uncompressedSize,
          mtimeMs: entry.mtimeMs,
          contentType: contentTypeForArchivePath(path),
          bytes: async () => readZipEntryBytes(zipFile, entry),
        },
      ];
    })
    .sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    );
}

async function readZipCentralDirectory(
  zipFile: File,
): Promise<ZipCentralEntry[]> {
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
      throw new Error("暂不支持 ZIP 压缩方法 " + compression + "。");
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
  if (
    fixed.byteLength !== 30 ||
    readUint32(fixed, 0) !== localFileHeaderSignature
  ) {
    throw new Error("ZIP local header 损坏：" + entry.normalizedPath);
  }

  const nameLength = readUint16(fixed, 26);
  const extraLength = readUint16(fixed, 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(
    await zipFile
      .slice(dataOffset, dataOffset + entry.compressedSize)
      .arrayBuffer(),
  );
  if (compressed.byteLength !== entry.compressedSize) {
    throw new Error("ZIP entry 数据截断：" + entry.normalizedPath);
  }

  if (entry.compression === zipMethodStore) {
    if (compressed.byteLength !== entry.uncompressedSize) {
      throw new Error("ZIP store entry 大小异常：" + entry.normalizedPath);
    }
    return compressed;
  }

  return inflateBytes(compressed, entry.uncompressedSize);
}

async function inflateBytes(
  bytes: Uint8Array,
  size: number,
): Promise<Uint8Array> {
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
    if (
      offset + 46 > central.byteLength ||
      readUint32(central, offset) !== centralDirectorySignature
    ) {
      break;
    }

    const flags = readUint16(central, offset + 8);
    const nameLength = readUint16(central, offset + 28);
    const extraLength = readUint16(central, offset + 30);
    const commentLength = readUint16(central, offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > central.byteLength) break;

    if ((flags & zipUtf8Flag) === 0) {
      const bytes = central.subarray(nameStart, nameEnd);
      const utf8 = tryDecodeUtf8(bytes);
      scores["utf-8"] += utf8 ? scoreLegacyZipPath(utf8) : -1000;
      scores.shift_jis += scoreLegacyZipPath(shiftJisTextDecoder.decode(bytes));
      scores.gb18030 += scoreLegacyZipPath(gb18030TextDecoder.decode(bytes));
      sampled += 1;
    }
    offset = nameEnd + extraLength + commentLength;
  }

  if (sampled === 0) return "utf-8";
  return (Object.entries(scores) as Array<[LegacyZipEncoding, number]>).sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0] ?? "shift_jis";
}

function decodeZipPath(
  bytes: Uint8Array,
  flags: number,
  legacyEncoding: LegacyZipEncoding,
): string {
  if ((flags & zipUtf8Flag) !== 0) return utf8TextDecoder.decode(bytes);
  switch (legacyEncoding) {
    case "utf-8":
      return utf8TextDecoder.decode(bytes);
    case "gb18030":
      return gb18030TextDecoder.decode(bytes);
    case "shift_jis":
      return shiftJisTextDecoder.decode(bytes);
  }
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8TextDecoder.decode(bytes);
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
    } else if (isHiragana(code) || isKatakana(code)) {
      score += 8;
    } else if (isCjk(code)) {
      score += 2;
    } else if (code >= 0x20 && code <= 0x7e) {
      score += 1;
    } else {
      score -= 1;
    }
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
  if (date === 0) return null;
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

function findZipGameRoot(entries: ZipCentralEntry[]): string {
  const mapTrees = entries.filter((entry) => {
    const path = entry.normalizedPath.toLowerCase();
    return path === "rpg_rt.lmt" || path.endsWith("/rpg_rt.lmt");
  });
  if (mapTrees.length === 0) {
    throw new Error("ZIP 内未找到 RPG_RT.lmt，请选择包含游戏文件的压缩包。");
  }
  if (mapTrees.length > 1) {
    throw new Error(
      "ZIP 内找到多个 RPG_RT.lmt，无法确定游戏根目录；请每次只上传一个游戏。",
    );
  }
  const path = mapTrees[0].normalizedPath;
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function pathWithinZipGameRoot(path: string, gameRoot: string): string | null {
  if (!gameRoot) return path;
  const prefix = gameRoot + "/";
  return path.toLowerCase().startsWith(prefix.toLowerCase())
    ? path.slice(prefix.length)
    : null;
}

function basename(path: string): string {
  const normalized = normalizeArchivePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
