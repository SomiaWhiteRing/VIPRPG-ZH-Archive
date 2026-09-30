import catalog from "./rtp-upload-catalog.json";
import type { ResourceFile } from "./lcf-reference-scan";
import { detectSourceEngine } from "./source-engine";

const normalize = (path: string) => path.normalize("NFC").toLowerCase();
export type RtpResource = ResourceFile & { crc32: number };

export function createRtpResolver(files: readonly ResourceFile[]) {
  const family = detectSourceEngine(files) === "rpg_maker_2000" ? "2000" : "2003";
  const preferredPaths = new Map<string, RtpResource[]>();
  const paths = new Map<string, RtpResource[]>();
  const preferredAliases = new Map<string, RtpResource[]>();
  const aliases = new Map<string, RtpResource[]>();
  const add = (index: Map<string, RtpResource[]>, path: string, file: RtpResource) => {
    const key = normalize(path);
    const bucket = index.get(key);
    if (bucket) bucket.push(file);
    else index.set(key, [file]);
  };
  const resources = catalog.entries.map((row) => {
    const [path, size, sha256, packs, crc32] = row as [string, number, string, string[], number];
    const file = { path, size, sha256, crc32 };
    add(paths, path, file);
    if (packs.some((pack) => pack.startsWith(family))) add(preferredPaths, path, file);
    return file;
  });
  for (const [aliasFamily, rows] of Object.entries(catalog.aliases)) {
    for (const [path, entryIndex] of rows as [string, number][]) {
      const file = resources[entryIndex];
      add(aliases, path, file);
      if (aliasFamily === family) add(preferredAliases, path, file);
    }
  }
  const indexes = [preferredPaths, paths, preferredAliases, aliases];
  return (directory: string, names: readonly string[]): RtpResource | null => {
    const extensions = directory === "Music" ? ["", ".mid", ".wav"]
      : directory === "Sound" ? ["", ".wav"]
      : directory === "Movie" ? ["", ".avi"] : ["", ".png"];
    // Prefer exact names in the engine family, then other packs, then known
    // aliases. An ambiguous tier must not fall through to a guessed replacement.
    for (const index of indexes) {
      const matches = new Map<string, RtpResource>();
      for (const name of names) {
        const base = `${directory}/${name}`;
        for (const extension of extensions) {
          for (const file of index.get(normalize(base + extension)) ?? []) {
            // Alias bytes keep the filename actually referenced by the game.
            if (!matches.has(file.sha256)) matches.set(file.sha256, { ...file, path: base + extension });
          }
        }
      }
      if (matches.size) return matches.size === 1 ? [...matches.values()][0] : null;
    }
    return null;
  };
}
