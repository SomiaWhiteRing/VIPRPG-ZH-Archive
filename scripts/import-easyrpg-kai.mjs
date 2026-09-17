import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const revision = "b3101682f5cf0b193a01f915f32a6da04f4818b6";
const version = `0.8.1.1-kai-${revision.slice(0, 9)}`;
const archiveSha256 =
  "895942acbda5e8c28f64af769e46cb6bf14e089548ce43314966d594f4ccd079";
const soundfontSha256 =
  "6c2ff6e9219989e0a2d39e633cbdc7d8f8a575903985160495aeab5d01cc48e6";
const root = fileURLToPath(new URL("../", import.meta.url));
const zipPath = process.argv[2];
if (!zipPath) throw new Error("Usage: node scripts/import-easyrpg-kai.mjs <web.zip>");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const archive = readFileSync(zipPath);
if (sha256(archive) !== archiveSha256)
  throw new Error("Web ZIP does not match the pinned Kai build");

const files = unzipSync(archive);
for (const name of ["easyrpg-player.js", "easyrpg-player.wasm", "easyrpg-player.data"])
  if (!files[name]?.length) throw new Error(`Missing runtime file: ${name}`);
if (sha256(files["easyrpg-player.data"]) !== soundfontSha256)
  throw new Error("Bundled SoundFont does not match Kai recommended.sf2");

let script = new TextDecoder().decode(files["easyrpg-player.js"]);
function replaceOnce(before, after) {
  if (script.split(before).length !== 2)
    throw new Error(`Runtime patch no longer matches: ${before}`);
  script = script.replace(before, after);
}

// Keep the site's existing Work-based IDBFS identity across runtime upgrades.
replaceOnce(
  'FS.mkdir("Save");FS.mount(Module.saveFs,{},"Save");',
  'if(!Number.isSafeInteger(Module.workId)||Module.workId<=0)throw new Error("Invalid workId");' +
    'FS.mkdir("/work-saves");const savePath="/work-saves/"+Module.workId;' +
    'FS.mkdir(savePath);FS.mount(Module.saveFs,{},savePath);FS.symlink(savePath,"Save");',
);
replaceOnce('return locateFile("easyrpg-player.wasm")', 'return locateFile("index.wasm")');

const output = {
  "index.js": Buffer.from(script),
  "index.wasm": files["easyrpg-player.wasm"],
  "easyrpg-player.data": files["easyrpg-player.data"],
};
const directory = resolve(root, "public/play/runtime/easyrpg", version);
mkdirSync(directory, { recursive: true });
for (const [name, bytes] of Object.entries(output))
  writeFileSync(resolve(directory, name), bytes);
writeFileSync(
  resolve(directory, "SOURCE.json"),
  JSON.stringify(
    {
      repository: "https://github.com/SomiaWhiteRing/Player",
      revision,
      version,
      build: "https://github.com/SomiaWhiteRing/Player/actions/runs/35185078515",
      artifact: "nightly-web/EasyRPG-Player-Kai-nightly-web.zip",
      archiveSha256,
      source: `https://github.com/SomiaWhiteRing/Player/tree/${revision}`,
      license: `https://github.com/SomiaWhiteRing/Player/blob/${revision}/COPYING`,
      patches: [
        "Work-based IDBFS saves",
        "WASM filename: index.wasm",
      ],
      files: Object.fromEntries(
        Object.entries(output).map(([name, bytes]) => [name, { size: bytes.length, sha256: sha256(bytes) }]),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Imported EasyRPG Kai ${revision} into ${directory}`);
