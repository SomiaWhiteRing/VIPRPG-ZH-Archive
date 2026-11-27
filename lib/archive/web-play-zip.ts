import type { ArchiveManifest } from "./manifest";
import { shouldSkipWebPlayDownloadFile } from "./web-play-download-policy";

type SortablePath = { path: string; pathSortKey?: string };

export function compareManifestFiles(left: SortablePath, right: SortablePath) {
  return (left.pathSortKey || left.path.toLowerCase()).localeCompare(
    right.pathSortKey || right.path.toLowerCase(),
  );
}

export function toDosDateTime(mtimeMs: number | null) {
  const date = mtimeMs === null ? new Date(Date.UTC(2026, 0, 1)) : new Date(mtimeMs);
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  };
}

// Compare exactly the inputs that can change the STORE ZIP bytes.
export function sameWebPlayZip(before: ArchiveManifest, after: ArchiveManifest): boolean {
  const ordered = (manifest: ArchiveManifest) => manifest.files
    .filter(file => !shouldSkipWebPlayDownloadFile(file.path)).sort(compareManifestFiles);
  const a = ordered(before), b = ordered(after);
  return a.length === b.length && a.every((file, i) => {
    const other = b[i];
    if (file.path !== other.path || file.sha256 !== other.sha256 || file.size !== other.size || file.crc32 !== other.crc32) return false;
    const left = toDosDateTime(file.mtimeMs), right = toDosDateTime(other.mtimeMs);
    return left.dosDate === right.dosDate && left.dosTime === right.dosTime;
  });
}
