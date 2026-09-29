import catalog from "./rtp-upload-catalog.json";
import type { ResourceFile } from "./lcf-reference-scan";
import { detectSourceEngine } from "./source-engine";

const normalize = (path: string) => path.normalize("NFC").toLowerCase();
export type RtpResource = ResourceFile & { crc32: number };

export function createRtpResolver(files: readonly ResourceFile[]) {
  const family = detectSourceEngine(files) === "rpg_maker_2000" ? "2000" : "2003";
  const paths = new Map<string, RtpResource[]>();
  for (const row of catalog.entries) {
    const [path, size, sha256, packs, crc32] = row as [string, number, string, string[], number];
    if (!packs.some((pack) => pack.startsWith(family))) continue;
    const file = { path, size, sha256, crc32 };
    const key = normalize(path);
    paths.set(key, [...paths.get(key) ?? [], file]);
  }
  return (directory: string, names: readonly string[]): RtpResource | null => {
    // Try the same decoded alternatives as the local resource lookup. Never
    // choose between distinct bytes within the detected engine family.
    const matches = new Map<string, RtpResource>();
    for (const name of names) {
      const base = `${directory}/${name}`;
      const extensions = directory === "Music" ? ["", ".mid", ".wav"]
        : directory === "Sound" ? ["", ".wav"]
        : directory === "Movie" ? ["", ".avi"] : ["", ".png"];
      for (const extension of extensions) {
        for (const file of paths.get(normalize(base + extension)) ?? []) {
          if (!matches.has(file.sha256)) matches.set(file.sha256, { ...file, path: base + extension });
        }
      }
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  };
}

