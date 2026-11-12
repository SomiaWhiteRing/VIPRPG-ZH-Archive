import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { constants, gzipSync, gunzipSync, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import runtime from "../lib/archive/easyrpg-runtime.json" with { type: "json" };

const root = resolve(import.meta.dirname, "..");
const delivery = "/play/runtime/android/v1";
const chunkSize = 1024 * 1024;
const maxFile = 32 * chunkSize;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const isDigest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const wireSize = parts => parts.reduce((size, part) => size + part.size, 0);

export async function buildAndroidPlayer(assets, origin) {
  const directory = join(assets, delivery.slice(1));
  const partsDir = join(directory, "parts");
  const previous = origin ? await fetch(new URL(delivery + "/latest.json", origin), {
    signal: AbortSignal.timeout(8_000), redirect: "error", cache: "no-store",
  }).then(async response => response.ok ? response.json() : null).catch(() => null) : null;
  const previousFiles = previous?.schema === 1 && Array.isArray(previous.files) ? previous.files : [];
  const scratch = await mkdtemp(join(tmpdir(), "viprpg-android-player-"));
  try {
    await mkdir(partsDir, { recursive: true });
    await cp(join(assets, "play/runtime/easyrpg", runtime.version), scratch, {
      recursive: true, filter: path => !path.endsWith(".br"),
    });
    const adapter = await readFile(join(root, "scripts/android-native-storage.js"), "utf8");
    await writeFile(join(scratch, "native-storage.js"), adapter.replaceAll("\r\n", "\n"));
    const files = [];
    for (const name of (await readdir(scratch)).sort()) {
      const bytes = await readFile(join(scratch, name));
      if (!bytes.length || bytes.length > maxFile) throw new Error(`Invalid Android Player file size: ${name}`);
      const digest = sha256(bytes);
      const parts = await writeParts(partsDir, gzipSync(bytes));
      const entry = { name, size: bytes.length, sha256: digest, parts };
      const base = name.endsWith(".wasm") && previousFiles.find(file => file?.name === name);
      if (base) {
        try {
          if (base.sha256 === digest && isDigest(base.patch?.base)) {
            // Keep the patch usable after a site-only redeploy.
            const patch = await readParts(origin, base.patch.parts);
            if (patch.length < wireSize(parts))
              entry.patch = { base: base.patch.base, parts: await writeParts(partsDir, patch) };
          } else if (isDigest(base.sha256) && base.sha256 !== digest) {
            const reference = gunzipSync(await readParts(origin, base.parts), { maxOutputLength: maxFile });
            if (sha256(reference) !== base.sha256) throw new Error("Previous Player file checksum mismatch");
            const patch = zstdCompressSync(bytes, {
              dictionary: reference,
              params: {
                [constants.ZSTD_c_compressionLevel]: 9,
                [constants.ZSTD_c_windowLog]: 26,
                [constants.ZSTD_c_enableLongDistanceMatching]: 1,
              },
            });
            if (patch.length < wireSize(parts)) {
              if (!zstdDecompressSync(patch, { dictionary: reference, maxOutputLength: maxFile }).equals(bytes))
                throw new Error("Android Player patch did not round-trip");
              entry.patch = { base: base.sha256, parts: await writeParts(partsDir, patch) };
            }
          }
        } catch (error) {
          console.warn(`Android Player patch unavailable for ${name}: ${error.message}`);
        }
      }
      files.push(entry);
    }
    const currentParts = new Set(files.flatMap(file =>
      [...file.parts, ...(file.patch?.parts ?? [])].map(part => part.sha256 + ".bin")));
    for (const name of await readdir(partsDir)) {
      if (/^[0-9a-f]{64}\.bin$/.test(name) && !currentParts.has(name)) await rm(join(partsDir, name));
    }
    const identity = files.map(({ name, sha256 }) => [name, sha256]);
    const id = sha256(JSON.stringify([runtime.version, identity]));
    await writeFile(join(directory, "latest.json"), JSON.stringify({ schema: 1, id, version: runtime.version, files }) + "\n");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function writeParts(directory, bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    const digest = sha256(chunk);
    await writeFile(join(directory, digest + ".bin"), chunk);
    parts.push({ sha256: digest, size: chunk.length });
  }
  return parts;
}

async function readParts(origin, parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 33 || parts.some(part =>
    !isDigest(part?.sha256) || !Number.isInteger(part.size) || part.size < 1 || part.size > chunkSize))
    throw new Error("Invalid previous Android Player parts");
  return Buffer.concat(await Promise.all(parts.map(async part => {
    const response = await fetch(new URL(`${delivery}/parts/${part.sha256}.bin`, origin), {
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    const length = response.headers.get("Content-Length");
    if (!response.ok || (length !== null && Number(length) !== part.size))
      throw new Error(`Previous Android Player part unavailable (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== part.size || sha256(bytes) !== part.sha256)
      throw new Error("Previous Android Player part checksum mismatch");
    return bytes;
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await buildAndroidPlayer(join(root, "public"));
}
