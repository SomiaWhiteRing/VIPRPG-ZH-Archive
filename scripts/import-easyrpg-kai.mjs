import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import runtime from "../lib/archive/easyrpg-runtime.json" with { type: "json" };

const { revision, version, build, archiveSha256, soundfontSha256, licenseSha256 } = runtime;
const root = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoot = resolve(root, "public/play/runtime/easyrpg");
if (!/^[a-z0-9][a-z0-9.-]*$/.test(version) || !/^[a-f0-9]{40}$/.test(revision))
  throw new Error("Invalid pinned Kai version or revision");
const zipPath = process.argv[2];
if (!zipPath) throw new Error("Usage: node scripts/import-easyrpg-kai.mjs <web.zip>");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const archive = readFileSync(zipPath);
if (sha256(archive) !== archiveSha256)
  throw new Error("Web ZIP does not match the pinned Kai build");

const files = unzipSync(archive);
const runtimeFiles = [
  "easyrpg-player.js", "easyrpg-player.wasm", "easyrpg-player.data",
  "player-worker.js", "player-audio.js",
  "player-audio-worker.js", "player-files.js", "web-audio.md",
  "player-movie.js", "player-movie-worker.js", "movie-decoder.js", "movie-decoder.wasm",
  "movie-decoder.LICENSE.txt", "web-movies.md",
];
for (const name of [...runtimeFiles, "player-host.js", "COPYING"])
  if (!files[name]?.length) throw new Error(`Missing runtime file: ${name}`);
if (sha256(files["easyrpg-player.data"]) !== soundfontSha256)
  throw new Error("Bundled SoundFont does not match Kai recommended.sf2");
const license = files.COPYING;
if (sha256(license) !== licenseSha256)
  throw new Error("Kai license does not match the pinned digest");
if (sha256(files["movie-decoder.LICENSE.txt"]) !== runtime.movieDecoder.licenseSha256)
  throw new Error("Movie decoder license does not match the pinned digest");

// Runtime source owns the site API and Work-based saves; import preserves every byte.
const output = {
  "index.js": files["player-host.js"],
  ...Object.fromEntries(runtimeFiles.map(name => [name, files[name]])),
};
const source =
  JSON.stringify(
    {
      repository: "https://github.com/SomiaWhiteRing/Player",
      revision,
      version,
      build,
      artifact: basename(zipPath),
      archiveSha256,
      source: `https://github.com/SomiaWhiteRing/Player/tree/${revision}`,
      license: `https://github.com/SomiaWhiteRing/Player/blob/${revision}/COPYING`,
      sourceState: runtime.sourceState ?? "commit",
      sourceSnapshot: runtime.sourceSnapshot ?? null,
      sourceSnapshotSha256: runtime.sourceSnapshotSha256 ?? null,
      liblcfRevision: runtime.liblcfRevision ?? null,
      emscriptenVersion: runtime.emscriptenVersion ?? null,
      buildscriptsRevision: runtime.buildscriptsRevision ?? null,
      movieDecoder: runtime.movieDecoder,
      patches: [],
      files: Object.fromEntries(
        Object.entries(output).map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }]),
      ),
    },
    null,
    2,
  ) + "\n";
const bundle = { ...output, COPYING: license, "SOURCE.json": Buffer.from(source) };
const directory = resolve(runtimeRoot, version);

// URLs are immutable: importing different bytes requires a new version name.
if (existsSync(directory)) {
  const names = readdirSync(directory);
  if (
    names.length !== Object.keys(bundle).length ||
    Object.entries(bundle).some(
      ([name, bytes]) =>
        !names.includes(name) || !readFileSync(resolve(directory, name)).equals(bytes),
    )
  ) throw new Error("Runtime directory differs; use a new pinned version before importing");
} else {
  mkdirSync(runtimeRoot, { recursive: true });
  const stagedDirectory = mkdtempSync(resolve(runtimeRoot, ".import-"));
  try {
    for (const [name, bytes] of Object.entries(bundle))
      writeFileSync(resolve(stagedDirectory, name), bytes);
    renameSync(stagedDirectory, directory);
  } finally {
    removeRuntimeDirectory(stagedDirectory);
  }
}

// A successful import leaves exactly one runtime in the next deployment.
for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
  if (entry.name === version || !entry.isDirectory()) continue;
  removeRuntimeDirectory(resolve(runtimeRoot, entry.name));
  console.log(`Removed obsolete runtime ${entry.name}`);
}
console.log(`Imported EasyRPG Kai ${revision} into ${directory}`);

function removeRuntimeDirectory(path) {
  if (dirname(path) !== runtimeRoot || path === directory)
    throw new Error(`Refusing to remove runtime path: ${path}`);
  rmSync(path, { recursive: true, force: true });
}
