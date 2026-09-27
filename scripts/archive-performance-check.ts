import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, zipSync } from "fflate";
import { crc32 } from "../lib/archive/crc32";
import { maybeHandleArchiveDownload } from "../worker/archive-download.mjs";
import { advanceGcCursor, scanGcCandidates } from "../app/.server/storage/gc-candidates";

// Emulate only platform transports; exercise the public download handler itself.
Object.defineProperty(globalThis, "FixedLengthStream", { value: class extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) {
    let written = 0;
    super({
      transform(chunk, controller) {
        written += chunk.byteLength;
        assert.ok(written <= expected, "fixed-length response overflow");
        controller.enqueue(chunk);
      },
      flush() { assert.equal(written, expected, "fixed-length response underflow"); },
    });
  }
} });
Object.defineProperty(globalThis, "caches", { value: { default: {
  async match() { return undefined; },
  async put(_key: Request, response: Response) { await response.arrayBuffer(); },
} } });

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const key = (prefix: string, hash: string, suffix = "") => `${prefix}/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${suffix}`;
const encode = (s: string) => new TextEncoder().encode(s);
type Slice = { offset: number; length: number };

async function checkDownload(sharedPlayer: boolean) {
  const files: Record<string, Uint8Array> = {
    "A-empty.bin": new Uint8Array(),
    "B-large.bin": Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, i) => i % 251),
    "C-small.bin": encode("a small independent blob"),
    "Map0001.lmu": encode("compressed map fixture"),
    "RPG_RT.ldb": encode("compressed database fixture"),
    "雪.png": encode("unicode path fixture"),
  };
  const pack = zipSync({ "Map0001.lmu": files["Map0001.lmu"], "RPG_RT.ldb": files["RPG_RT.ldb"], "unrequested.bin": new Uint8Array(65536) });
  const packHash = sha(pack);
  const objects = new Map<string, Uint8Array>([[key("core-packs", packHash, ".zip"), pack]]);
  const playerBytes = encode("shared player bytes");
  const playerHash = sha(playerBytes);
  const playerKey = "tools/artifacts/player.exe";
  objects.set(playerKey, playerBytes);
  const sourceKeys = new Map<string, string>();
  const manifest = {
    schema: "viprpg-archive.manifest.v1",
    archiveVersion: { sharedPlayer: sharedPlayer ? { fixture: true } : null },
    corePacks: [{ id: "core", sha256: packHash }],
    files: Object.entries(files).map(([path, bytes]) => {
      const hash = sha(bytes);
      const core = /\.(lmu|ldb)$/.test(path);
      const objectKey = core ? key("core-packs", packHash, ".zip") : key("blobs", hash);
      sourceKeys.set(path, objectKey);
      if (!core) objects.set(objectKey, bytes);
      return { path, pathSortKey: path.toLowerCase(), size: bytes.length, sha256: hash, crc32: crc32(bytes), mtimeMs: null,
        storage: core ? { kind: "core_pack", packId: "core", entry: path } : { kind: "blob", blobSha256: hash } };
    }),
  };
  const manifestBytes = encode(JSON.stringify(manifest));
  const manifestHash = sha(manifestBytes);
  objects.set(key("manifests", manifestHash, ".json"), manifestBytes);
  if (sharedPlayer) { files["Player.exe"] = playerBytes; sourceKeys.set("Player.exe", playerKey); }
  let reads: { key: string; range?: Slice; length: number }[] = [];
  const metadata = (objectKey: string, bytes: Uint8Array) => ({ key: objectKey, size: bytes.length,
    checksums: { sha256: Uint8Array.from(Buffer.from(sha(bytes), "hex")).buffer } });
  const bucket = {
    async head(objectKey: string) { const bytes = objects.get(objectKey); return bytes ? metadata(objectKey, bytes) : null; },
    async get(objectKey: string, options?: { range: Slice }) {
      const bytes = objects.get(objectKey);
      if (!bytes) return null;
      const range = options?.range;
      if (range) assert.ok(range.length > 0, "never issue an empty object range");
      const selected = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      reads.push({ key: objectKey, range, length: selected.length });
      return { ...metadata(objectKey, bytes), body: new Blob([new Uint8Array(selected)]).stream(),
        async arrayBuffer() { return new Uint8Array(selected).buffer; },
        async text() { return new TextDecoder().decode(selected); } };
    },
  };
  const database = { prepare(sql: string) {
    return { bind() { return this; }, async run() { return { success: true }; }, async first() {
      if (sql.includes("FROM resources p")) return { id: "player", storage_status: "ready", format: "exe",
        object_key: playerKey, size_bytes: playerBytes.length, sha256: playerHash, crc32: crc32(playerBytes) };
      return { id: 1, work_id: 1, work_original_title: "Fixture", manifest_sha256: manifestHash,
        packer_version: "fixture", total_size_bytes: 1, estimated_r2_get_count: Object.keys(files).length,
        uses_shared_player: sharedPlayer ? 1 : 0, engine_family: "rpg_maker_2000" };
    } };
  } };
  const env = { DB: database, ARCHIVE_BUCKET: bucket, APP_ORIGIN: "https://archive.example.test" };
  async function download(range?: string, extra: Record<string, string> = {}, method = "GET") {
    reads = [];
    const pending: Promise<unknown>[] = [];
    const response = await maybeHandleArchiveDownload(new Request(
      `https://archive.example.test/api/archive-versions/1/download${sharedPlayer ? "?player=player" : ""}`,
      { method, headers: { ...(range ? { Range: range } : {}), ...extra } },
    ), env, { waitUntil(promise: Promise<unknown>) { pending.push(promise); } });
    assert.ok(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await Promise.all(pending);
    return { response, bytes };
  }
  const full = await download();
  assert.equal(full.response.status, 200);
  const extracted = unzipSync(full.bytes);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(files).sort());
  for (const [path, bytes] of Object.entries(files)) assert.deepEqual(extracted[path], bytes);
  // Read offsets from the actual ZIP format, independently of the writer.
  const entries: { path: string; start: number; end: number }[] = [];
  const view = new DataView(full.bytes.buffer);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const path = new TextDecoder().decode(full.bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.push({ path, start, end: start + size });
    offset = start + size;
  }
  const ranges: [number, number][] = [[0, 0], [offset, full.bytes.length - 1], [0, full.bytes.length - 1]];
  for (const entry of entries) {
    ranges.push([entry.start - 2, Math.min(full.bytes.length - 1, entry.start + 2)]);
    if (entry.end > entry.start) ranges.push([entry.end - 1, entry.end - 1], [entry.start, entry.end - 1]);
  }
  const large = entries.find((entry) => entry.path === "B-large.bin")!;
  ranges.push([large.start + 1000, large.start + 1002]);
  for (const [start, end] of ranges) {
    const part = await download(`bytes=${start}-${end}`);
    assert.equal(part.response.status, 206);
    assert.equal(part.response.headers.get("content-range"), `bytes ${start}-${end}/${full.bytes.length}`);
    assert.equal(Number(part.response.headers.get("content-length")), end - start + 1);
    assert.deepEqual(part.bytes, full.bytes.slice(start, end + 1));
    const needed = entries.filter((e) => e.end > e.start && e.start <= end && e.end > start);
    const bodyReads = reads.filter((read) => !read.key.startsWith("manifests/"));
    assert.deepEqual(new Set(bodyReads.map((read) => read.key)), new Set(needed.map((e) => sourceKeys.get(e.path))));
    for (const entry of needed.filter((e) => !sourceKeys.get(e.path)!.startsWith("core-packs/"))) {
      const read = bodyReads.find((r) => r.key === sourceKeys.get(entry.path))!;
      const length = Math.min(entry.end, end + 1) - Math.max(entry.start, start);
      assert.deepEqual(read.range, { offset: Math.max(0, start - entry.start), length });
      assert.equal(read.length, length, "read no bytes outside the requested blob interval");
    }
  }
  assert.deepEqual((await download("bytes=-22")).bytes, full.bytes.slice(-22));
  assert.deepEqual((await download(`bytes=${large.end - 3}-`)).bytes, full.bytes.slice(large.end - 3));
  assert.equal((await download(`bytes=${full.bytes.length}-`)).response.status, 416);
  assert.equal((await download("bytes=0-1,3-4")).response.status, 416);
  const head = await download(undefined, {}, "HEAD");
  assert.equal(Number(head.response.headers.get("content-length")), full.bytes.length);
  assert.equal(head.bytes.length, 0);
  assert.ok(reads.every((r) => r.key.startsWith("manifests/")));
  assert.deepEqual((await download("bytes=0-2", { "If-Range": '"outdated"' })).bytes, full.bytes);
}

async function checkGc() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  try {
    for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
    }
    class Statement {
      constructor(private sql: string, private values: (string | number | null)[] = []) {}
      bind(...values: (string | number | null)[]) { return new Statement(this.sql, values); }
      execute() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async first() { return this.execute().results[0] ?? null; }
    }
    const db = { prepare: (sql: string) => new Statement(sql), async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const result = statements.map((s) => s.execute()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    } } as unknown as D1Database;
    const hash = (n: number) => n.toString(16).padStart(64, "0");
    for (let n = 1; n <= 34; n++) {
      sqlite.prepare("INSERT INTO blobs(sha256,size_bytes,created_at) VALUES(?,1,?)")
        .run(hash(n), n === 34 ? new Date().toISOString() : "2000-01-01 00:00:00");
      if (n <= 25) sqlite.prepare("INSERT INTO resources(id,kind,slug,name,icon_blob_sha256) VALUES(?,'website',?,'Retained',?)")
        .run(`resource-${n}`, `resource-${n}`, hash(n));
    }
    const prefix = await scanGcCandidates(db, "blob", 7, 2);
    assert.equal(prefix.scannedCount, 20);
    assert.equal(prefix.rows.length, 0);
    assert.equal(prefix.completed, false);
    await advanceGcCursor(db, "blob", prefix);
    const page = await scanGcCandidates(db, "blob", 7, 2);
    assert.deepEqual(page.rows.map((r) => r.sha256), [hash(26), hash(27)]);
    // A crash before advancement replays the same page.
    assert.deepEqual((await scanGcCandidates(db, "blob", 7, 2)).rows, page.rows);
    await advanceGcCursor(db, "blob", page);
    const seen = new Set(page.rows.map((r) => r.sha256));
    const next = await scanGcCandidates(db, "blob", 7, 2);
    await advanceGcCursor(db, "blob", next);
    const cursor = sqlite.prepare("SELECT sha256 FROM archive_gc_cursors WHERE object_type='blob'").get();
    await advanceGcCursor(db, "blob", page);
    await advanceGcCursor(db, "blob", prefix);
    assert.deepEqual(sqlite.prepare("SELECT sha256 FROM archive_gc_cursors WHERE object_type='blob'").get(), cursor,
      "stale invocations cannot rewind an advanced cursor");
    next.rows.forEach((r) => seen.add(r.sha256));
    for (let attempt = 0; attempt < 10; attempt++) {
      const batch = await scanGcCandidates(db, "blob", 7, 2);
      assert.ok(batch.rows.length <= 2 && batch.scannedCount <= 20);
      batch.rows.forEach((r) => { assert.ok(!seen.has(r.sha256)); seen.add(r.sha256); });
      await advanceGcCursor(db, "blob", batch);
      if (batch.completed) break;
    }
    assert.deepEqual([...seen], Array.from({ length: 8 }, (_, i) => hash(i + 26)));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM archive_gc_cursors").get()!.n, 0);
    // An earlier retained object becomes eligible after references disappear.
    sqlite.exec("DELETE FROM resources WHERE id='resource-1'");
    assert.equal((await scanGcCandidates(db, "blob", 7, 2)).rows[0].sha256, hash(1));
    sqlite.prepare("INSERT INTO core_packs(sha256,size_bytes,uncompressed_size_bytes,file_count,created_at) VALUES(?,1,1,1,'2000-01-01')").run(hash(90));
    const core = await scanGcCandidates(db, "core_pack", 7, 1);
    assert.deepEqual(core.rows.map((r) => r.sha256), [hash(90)]);
    await advanceGcCursor(db, "core_pack", core);
    const end = await scanGcCandidates(db, "core_pack", 7, 1);
    assert.equal(end.completed, true);
    await advanceGcCursor(db, "core_pack", end);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM archive_gc_cursors").get()!.n, 0);
  } finally { sqlite.close(); }
}

await checkDownload(false);
await checkDownload(true);
await checkGc();
console.log("Archive performance contracts passed: ZIP ranges and bounded object reads, shared player ranges, GC pagination/replay/wraparound/concurrent progress.");
