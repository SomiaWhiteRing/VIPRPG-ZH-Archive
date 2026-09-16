import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { runWrangler } from "./run-wrangler.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  capture: { type: "boolean" },
  verify: { type: "boolean" },
  "persist-to": { type: "string", default: ".wrangler/state" },
} });
if (values.capture && values.verify) throw new Error("Choose either --capture or --verify.");
const state = resolve(root, values["persist-to"], "v3");
const seedDir = join(root, "data/local-seed");
const outputDir = join(root, "output/local-seed", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(outputDir, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

function databasePath(kind, required = true) {
  const dir = join(state, kind, kind === "d1" ? "miniflare-D1DatabaseObject" : "miniflare-R2BucketObject");
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite") : [];
  if (!files.length && !required) return null;
  if (files.length !== 1) throw new Error(`Expected exactly one local ${kind} database in ${dir}; found ${files.length}.`);
  return join(dir, files[0]);
}

async function snapshot(sourcePath, destination) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, destination); } finally { source.close(); }
}

function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${path}`);
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error(`Foreign key violations: ${JSON.stringify(foreignKeys)}`);
    const counts = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
      counts[name] = db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n;
    }
    return counts;
  } finally { db.close(); }
}

function repoFile(path) {
  const full = resolve(root, path);
  if (!full.startsWith(root + sep)) throw new Error(`Asset outside repository: ${path}`);
  return full;
}

function assetBytes(item) {
  const bytes = readFileSync(repoFile(item.file));
  if (bytes.length !== item.size || hash(bytes) !== item.sha256) throw new Error(`Seed asset changed: ${item.file}`);
  return bytes;
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function checkReferences(dbPath, objects) {
  const keys = new Set(objects.map((object) => object.key));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const required = [];
    const shaKey = (prefix, sha, suffix = "") => `${prefix}/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}${suffix}`;
    for (const row of db.prepare("SELECT sha256 FROM blobs WHERE status = 'active'").all()) required.push(shaKey("blobs", row.sha256));
    for (const row of db.prepare("SELECT sha256 FROM core_packs WHERE status = 'active'").all()) required.push(shaKey("core-packs", row.sha256, ".zip"));
    for (const row of db.prepare("SELECT manifest_sha256 FROM archive_versions WHERE purged_at IS NULL").all()) required.push(shaKey("manifests", row.manifest_sha256, ".json"));
    for (const row of db.prepare("SELECT object_key FROM forum_images WHERE status = 'ready'").all()) required.push(row.object_key);
    const missing = required.filter((key) => !keys.has(key));
    if (missing.length) throw new Error(`Missing R2 objects referenced by D1: ${JSON.stringify(missing)}`);
    return new Set(required).size;
  } finally { db.close(); }
}

async function capture() {
  const dbPath = join(outputDir, "database.sqlite");
  await snapshot(databasePath("d1"), dbPath);
  const tables = inspectDatabase(dbPath);
  const r2Path = join(outputDir, "r2.sqlite");
  await snapshot(databasePath("r2"), r2Path);
  const r2 = new DatabaseSync(r2Path, { readOnly: true });
  let rows;
  try { rows = r2.prepare("SELECT * FROM _mf_objects ORDER BY key").all(); } finally { r2.close(); }

  // Reuse immutable repository images, and export only objects unique to local R2.
  const existing = new Map();
  for (const folder of ["data/character-face-sheets/assets", "data/character-materials/assets"]) {
    for (const name of readdirSync(join(root, folder))) {
      const sha = name.split(".")[0];
      if (/^[a-f0-9]{64}$/.test(sha) && !existing.has(sha)) existing.set(sha, `${folder}/${name}`);
    }
  }
  const bucketDirs = readdirSync(join(state, "r2"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(state, "r2", entry.name, "blobs")))
    .map((entry) => join(state, "r2", entry.name, "blobs"));
  const objects = [];
  mkdirSync(join(seedDir, "objects"), { recursive: true });
  for (const row of rows) {
    const candidates = bucketDirs.map((dir) => join(dir, row.blob_id)).filter(existsSync);
    if (candidates.length !== 1) throw new Error(`Cannot locate local R2 bytes: ${row.key}`);
    const bytes = readFileSync(candidates[0]);
    const sha256 = hash(bytes);
    if (bytes.length !== row.size) throw new Error(`Local R2 object size mismatch: ${row.key}`);
    const keyedSha = row.key.match(/\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})(?:\.[a-z]+)?$/)?.[1];
    if (keyedSha && keyedSha !== sha256) throw new Error(`Local R2 object hash mismatch: ${row.key}`);
    let file = existing.get(sha256);
    if (!file) {
      file = `data/local-seed/objects/${sha256}`;
      copyFileSync(candidates[0], repoFile(file));
    }
    const item = { key: row.key, file, sha256, size: row.size,
      httpMetadata: JSON.parse(row.http_metadata), customMetadata: JSON.parse(row.custom_metadata) };
    assetBytes(item);
    objects.push(item);
  }
  const referencedObjects = checkReferences(dbPath, objects);
  const bytes = readFileSync(dbPath);
  const compressed = gzipSync(bytes, { level: 9 });
  // Publish the manifest last, so a partial capture cannot be mistaken for a valid seed.
  writeFileSync(join(seedDir, "database.sqlite.gz"), compressed);
  const manifest = { schema: "viprpg-local-seed.v1", capturedAt: new Date().toISOString(),
    database: { file: "data/local-seed/database.sqlite.gz", sha256: hash(bytes), size: bytes.length,
      gzipSha256: hash(compressed), tables },
    referencedObjects, objects };
  writeJson(join(seedDir, "manifest.json"), manifest);
  console.log(`Captured ${tables.characters} characters, ${tables.character_default_portraits} default portraits, ${objects.length} R2 objects.`);
}

function verify() {
  const manifest = JSON.parse(readFileSync(join(seedDir, "manifest.json"), "utf8"));
  if (manifest.schema !== "viprpg-local-seed.v1") throw new Error("Unknown seed format.");
  const compressed = readFileSync(repoFile(manifest.database.file));
  if (hash(compressed) !== manifest.database.gzipSha256) throw new Error("Seed database gzip hash mismatch.");
  const bytes = gunzipSync(compressed);
  if (hash(bytes) !== manifest.database.sha256 || bytes.length !== manifest.database.size) throw new Error("Seed database hash mismatch.");
  const dbPath = join(outputDir, "database.sqlite");
  writeFileSync(dbPath, bytes);
  const tables = inspectDatabase(dbPath);
  if (JSON.stringify(tables) !== JSON.stringify(manifest.database.tables)) throw new Error("Seed table counts mismatch.");
  const seen = new Set();
  for (const item of manifest.objects) {
    if (seen.has(item.key)) throw new Error(`Duplicate R2 key: ${item.key}`);
    seen.add(item.key);
    assetBytes(item);
  }
  const referencedObjects = checkReferences(dbPath, manifest.objects);
  writeJson(join(outputDir, "verification.json"), { databaseSha256: hash(bytes), tables,
    verifiedObjects: seen.size, referencedObjects, integrity: "ok", foreignKeyViolations: 0 });
  console.log(`Verified seed: ${tables.characters} characters, ${seen.size} R2 objects. Report: ${relative(root, outputDir)}`);
  return { manifest, dbPath };
}

function requireEmptyDatabase(path) {
  if (!path) return;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // Fresh migrations populate permission templates and FTS internals only.
    const tables = db.prepare(`SELECT name FROM pragma_table_list
      WHERE schema = 'main' AND type IN ('table', 'virtual')
        AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
        AND name NOT IN ('d1_migrations', 'roles', 'role_permissions')`).all();
    for (const { name } of tables) {
      if (db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n) {
        throw new Error("Local database contains application data. Seed restoration requires an empty database; stop the server and back up your data before db:local:reset.");
      }
    }
  } finally { db.close(); }
}

async function restore() {
  requireEmptyDatabase(databasePath("d1", false));
  const { manifest, dbPath } = verify();
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[name];
  process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
  process.env.WRANGLER_SEND_METRICS = "false";
  const { getPlatformProxy } = await import("wrangler");
  const platform = await getPlatformProxy({ configPath: join(root, "wrangler.jsonc"),
    persist: { path: state }, remoteBindings: false, envFiles: [] });
  try {
    await platform.env.DB.prepare("SELECT 1").first();
    requireEmptyDatabase(databasePath("d1"));
    let restored = 0;
    for (const item of manifest.objects) {
      await platform.env.ARCHIVE_BUCKET.put(item.key, assetBytes(item), {
        httpMetadata: item.httpMetadata, customMetadata: item.customMetadata,
      });
      if (++restored % 1000 === 0) console.log(`Restored R2 ${restored}/${manifest.objects.length}`);
    }
  } finally { await platform.dispose(); }
  const target = databasePath("d1");
  requireEmptyDatabase(target);
  await snapshot(target, join(outputDir, "before.sqlite"));
  // SQLite's online backup restores schema, FTS shadow tables, IDs and sequences together.
  await snapshot(dbPath, target);
  const tables = inspectDatabase(target);
  if (JSON.stringify(tables) !== JSON.stringify(manifest.database.tables)) throw new Error("Restored table counts mismatch.");
  await runWrangler([
    "d1", "migrations", "apply", "DB", "--local",
    "--config", join(root, "wrangler.jsonc"), "--persist-to", dirname(state),
  ]);
  inspectDatabase(target);
  console.log(`Restored fixed seed from ${manifest.capturedAt} into ${state}. Existing data was not regenerated.`);
}

if (values.capture) await capture();
else if (values.verify) verify();
else await restore();
