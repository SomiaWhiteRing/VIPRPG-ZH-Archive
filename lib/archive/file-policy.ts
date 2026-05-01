export const FILE_POLICY_VERSION = "rpgm2000-2003-whitelist-v3";
export const PACKER_VERSION = "browser-upload-phase-d-2026-05";

export type ArchiveFileRole =
  | "map"
  | "database"
  | "asset"
  | "runtime"
  | "metadata"
  | "other";

export type ArchiveStorageKind = "blob" | "core_pack";

export type ArchiveFileClassification =
  | {
      included: true;
      fileType: string;
      role: ArchiveFileRole;
      storageKind: ArchiveStorageKind;
      packEntryPath: string | null;
    }
  | {
      included: false;
      fileType: string;
      reason: string;
    };

const allowedFileTypeKeys = new Set([
  ".ini",
  ".exe",
  ".dll",
  ".ttf",
  ".ttc",
  ".otf",
  ".fon",
  ".gif",
  ".ico",
  ".ldb",
  ".lmt",
  ".lmu",
  ".png",
  ".jpg",
  ".bmp",
  ".xyz",
  ".txt",
  ".wav",
  ".mid",
  ".midi",
  ".mp3",
  ".ogg",
  ".oga",
  ".flac",
  ".opus",
  ".wma",
  ".avi",
  ".mpg",
  ".mpeg",
]);

const coreExactNames = new Set(["rpg_rt.ldb", "rpg_rt.lmt", "rpg_rt.ini"]);
const runtimeExts = new Set([".exe", ".dll"]);
const stringScriptDirs = new Set(["stringscripts", "stringscripts_origin"]);

const contentTypes: Record<string, string> = {
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".dll": "application/octet-stream",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".flac": "audio/flac",
  ".fon": "application/octet-stream",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".ini": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".ldb": "application/octet-stream",
  ".lmt": "application/octet-stream",
  ".lmu": "application/octet-stream",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".mpeg": "video/mpeg",
  ".mp3": "audio/mpeg",
  ".mpg": "video/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".otf": "font/otf",
  ".png": "image/png",
  ".ttc": "font/collection",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".wma": "audio/x-ms-wma",
  ".xyz": "application/octet-stream",
};

export function allowedFileTypes(): string[] {
  return [...allowedFileTypeKeys].sort();
}

export function normalizeArchivePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function fileTypeKey(path: string): string {
  const lower = basename(path).toLowerCase();

  if (/\.7z\.\d{3}$/.test(lower)) {
    return ".7z.###";
  }

  if (/\.zip\.\d{3}$/.test(lower)) {
    return ".zip.###";
  }

  if (/\.z\d{2}$/.test(lower)) {
    return ".z##";
  }

  if (/\.r\d{2}$/.test(lower)) {
    return ".r##";
  }

  if (/\.part\d+\.rar$/.test(lower)) {
    return ".partN.rar";
  }

  return extension(lower) || "(no-extension)";
}

export function contentTypeForArchivePath(path: string): string {
  return contentTypes[extension(path).toLowerCase()] ?? "application/octet-stream";
}

export function classifyArchivePath(
  rawPath: string,
  metadataPaths: Set<string> = new Set(),
): ArchiveFileClassification {
  const path = normalizeArchivePath(rawPath);
  const forcedExclusion = forcedExclusionReason(path);
  const typeKey = fileTypeKey(path);

  if (forcedExclusion || !allowedFileTypeKeys.has(typeKey)) {
    return {
      included: false,
      fileType: forcedExclusion ?? typeKey,
      reason: forcedExclusion ?? "not-in-whitelist",
    };
  }

  const role = roleFor(path, metadataPaths);
  const storageKind = isCorePackFile(path) ? "core_pack" : "blob";

  return {
    included: true,
    fileType: typeKey,
    role,
    storageKind,
    packEntryPath: storageKind === "core_pack" ? path : null,
  };
}

export function isCorePackFile(path: string): boolean {
  return isCoreFile(path) || isStringScriptTxt(path);
}

function forcedExclusionReason(path: string): string | null {
  const parts = normalizeArchivePath(path).split("/").filter(Boolean);

  if (parts.length === 0) {
    return "invalid-path";
  }

  const top = parts[0].toLowerCase();
  const name = parts.at(-1)?.toLowerCase() ?? "";

  if (stringScriptDirs.has(top) && extension(name).toLowerCase() !== ".txt") {
    return "string-scripts-non-txt";
  }

  if (top === "screenshots") {
    return "screenshots-dir";
  }

  if (parts.length === 1 && name.includes("screenshot")) {
    return "root-screenshot-file";
  }

  if (parts.length === 1 && name === "null.txt") {
    return "root-null-txt";
  }

  return null;
}

function roleFor(path: string, metadataPaths: Set<string>): ArchiveFileRole {
  const name = basename(path).toLowerCase();
  const ext = extension(name).toLowerCase();

  if (isCoreFile(path)) {
    return ext === ".lmu" ? "map" : "database";
  }

  if (isStringScriptTxt(path)) {
    return "other";
  }

  if (metadataPaths.has(path)) {
    return "metadata";
  }

  if (runtimeExts.has(ext)) {
    return "runtime";
  }

  return "asset";
}

function isCoreFile(path: string): boolean {
  const name = basename(path).toLowerCase();

  return (
    coreExactNames.has(name) ||
    (name.startsWith("map") &&
      name.endsWith(".lmu") &&
      name.length === "map0001.lmu".length &&
      /^\d{4}$/.test(name.slice(3, 7)))
  );
}

function isStringScriptTxt(path: string): boolean {
  const parts = normalizeArchivePath(path).split("/").filter(Boolean);

  return (
    parts.length >= 2 &&
    stringScriptDirs.has(parts[0].toLowerCase()) &&
    extension(parts.at(-1) ?? "").toLowerCase() === ".txt"
  );
}

function basename(path: string): string {
  const normalized = normalizeArchivePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function extension(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}
