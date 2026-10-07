import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { crc32, Crc32 } from "../lib/archive/crc32.ts";
import { downloadCacheMaxBytes } from "../lib/archive/download.ts";

// Exercise backpressured ZIP -> R2.put and conditional full/partial cache reads
// in workerd, including an archive larger than 128 MiB. Local only.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "viprpg-download-cache-"));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const bytes = Uint8Array.from({ length: 131_075 }, (_, i) => i % 251);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const blobHash = sha(bytes);
const manifest = JSON.stringify({ schema: "viprpg-archive.manifest.v1", archiveVersion: { sharedPlayer: null }, corePacks: [], files: [
  { path: "Picture/cache.bin", pathSortKey: "picture/cache.bin", size: bytes.length, sha256: blobHash,
    crc32: crc32(bytes), mtimeMs: null, storage: { kind: "blob", blobSha256: blobHash } },
] });
const manifestHash = sha(manifest);
const bigSize = 285_213_672;
const chunk = Uint8Array.from({ length: 65536 }, (_, i) => i % 251);
const bigHashState = createHash("sha256");
const bigCrc = new Crc32();
for (let offset = 0; offset < bigSize; offset += chunk.length) {
  const part = chunk.subarray(0, Math.min(chunk.length, bigSize - offset));
  bigHashState.update(part); bigCrc.update(part);
}
const bigHash = bigHashState.digest("hex");
const bigManifest = JSON.stringify({ schema: "viprpg-archive.manifest.v1", archiveVersion: { sharedPlayer: null }, corePacks: [], files: [
  { path: "Picture/big.bin", pathSortKey: "picture/big.bin", size: bigSize, sha256: bigHash,
    crc32: bigCrc.digest(), mtimeMs: null, storage: { kind: "blob", blobSha256: bigHash } },
] });
const bigManifestHash = sha(bigManifest);
const objectKey = (kind, hash, suffix = "") => `${kind}/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${suffix}`;
const entry = `import { maybeHandleArchiveDownload } from ${JSON.stringify(relative(temp, resolve(root, "worker/archive-download.mjs")).replaceAll("\\", "/"))};
const record = ${JSON.stringify({ id: 1, work_id: 1, work_original_title: "Runtime fixture", manifest_sha256: manifestHash,
  packer_version: "fixture", total_size_bytes: bytes.length, estimated_r2_get_count: 1, uses_shared_player: 0, engine_family: "rpg_maker_2000" })};
const db = { prepare(sql) { return { bind() { return this; }, async run() { return {success:true}; }, async first() {
  return sql.includes('SELECT full_download_count') ? {full_download_count:2,size_bytes:${bytes.length}} : record;
} }; } };
// No completed downloads: high source cost must admit the initial Range too.
const bigDb = { prepare(sql) { return { bind() { return this; }, async run() { return {success:true}; }, async first() {
  return sql.includes('SELECT full_download_count') ? null : {...record,id:2,manifest_sha256:${JSON.stringify(bigManifestHash)},
    total_size_bytes:${bigSize},estimated_r2_get_count:256};
} }; } };
export default { async fetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (path === '/__health') return new Response('ready');
  if (path === '/__setup') {
    await env.ARCHIVE_BUCKET.put(${JSON.stringify(objectKey("blobs", blobHash))}, Uint8Array.from({length:${bytes.length}},(_,i)=>i%251));
    await env.ARCHIVE_BUCKET.put(${JSON.stringify(objectKey("manifests", manifestHash, ".json"))}, ${JSON.stringify(manifest)});
    return new Response('ready');
  }
  if (path === '/__cache') return Response.json((await env.ARCHIVE_BUCKET.list({prefix:'download-cache/'})).objects.map(o=>({key:o.key,size:o.size})));
  if (path === '/__clear-cache') {
    for (const o of (await env.ARCHIVE_BUCKET.list({prefix:'download-cache/'})).objects) await env.ARCHIVE_BUCKET.delete(o.key);
    return new Response('cleared');
  }
  if (path === '/__setup-big') {
    const stream = new FixedLengthStream(${bigSize});
    const writer = stream.writable.getWriter();
    const put = env.ARCHIVE_BUCKET.put(${JSON.stringify(objectKey("blobs", bigHash))}, stream.readable);
    for (let offset=0;offset<${bigSize};offset+=65536)
      await writer.write(Uint8Array.from({length:Math.min(65536,${bigSize}-offset)},(_,i)=>i%251));
    await writer.close(); await put;
    await env.ARCHIVE_BUCKET.put(${JSON.stringify(objectKey("manifests", bigManifestHash, ".json"))}, ${JSON.stringify(bigManifest)});
    return new Response('ready');
  }
  if (path === '/__conditional') {
    const listed = (await env.ARCHIVE_BUCKET.list({prefix:'download-cache/'})).objects[0];
    await env.ARCHIVE_BUCKET.put(listed.key, 'replaced');
    const result = await env.ARCHIVE_BUCKET.get(listed.key,{range:{offset:0,length:3},onlyIf:{etagMatches:listed.etag}});
    return Response.json({hasBody:Boolean(result?.body)});
  }
  return await maybeHandleArchiveDownload(request,{...env,DB:path.includes('/2/')?bigDb:db},ctx) ?? new Response('',{status:404});
} };`;
writeFileSync(join(temp, "worker.mjs"), entry);
writeFileSync(join(temp, "wrangler.json"), JSON.stringify({
  name: "viprpg-download-cache-check", main: "worker.mjs", compatibility_date: "2026-04-30",
  compatibility_flags: ["nodejs_compat"], r2_buckets: [{ binding: "ARCHIVE_BUCKET", bucket_name: "download-cache-check" }],
  vars: { APP_ORIGIN: `http://127.0.0.1:${port}` },
}));
const child = spawn(process.execPath, [resolve(root, "node_modules/wrangler/wrangler-dist/cli.js"),
  "dev", "--config", join(temp, "wrangler.json"), "--local", "--port", String(port), "--persist-to", join(temp, "state")],
{ cwd: root, windowsHide: true, env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
let succeeded = false;
child.stdout.on("data", (chunk) => { log += chunk; });
child.stderr.on("data", (chunk) => { log += chunk; });
const origin = `http://127.0.0.1:${port}`;
const request = (path, init = {}) => fetch(origin + path, { ...init, signal: AbortSignal.timeout(120_000) });
async function digestResponse(response, tailStart = 0, pause = false) {
  const hash = createHash("sha256"), tail = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    if (!size && pause) await new Promise((resolve) => setTimeout(resolve, 100));
    hash.update(chunk);
    if (size + chunk.length > tailStart) tail.update(chunk.subarray(Math.max(0, tailStart - size)));
    size += chunk.length;
  }
  return { size, hash: hash.digest("hex"), tail: tail.digest("hex") };
}
async function until(check, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Worker exited: ${child.exitCode}`);
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
try {
  await until(async () => { try { return (await request("/__health")).ok; } catch { return false; } }, "local worker");
  assert.equal((await request("/__setup", { method: "POST" })).status, 200);
  const path = "/api/archive-versions/1/download";
  const generated = await request(path);
  const zip = new Uint8Array(await generated.arrayBuffer());
  assert.equal(generated.headers.get("Content-Length"), String(zip.length));
  assert.equal(generated.status, 200, new TextDecoder().decode(zip.subarray(0, 2000)));
  assert.deepEqual(unzipSync(zip)["Picture/cache.bin"], bytes);
  await until(async () => (await (await request("/__cache")).json()).length === 1, "atomic R2 cache PUT");
  const hit = await request(path);
  assert.equal(hit.headers.get("X-Download-Cache-Tier"), "r2");
  assert.deepEqual(new Uint8Array(await hit.arrayBuffer()), zip);
  assert.equal(hit.headers.get("ETag"), generated.headers.get("ETag"));
  const part = await request(path, { headers: { Range: "bytes=17-70001", "If-Range": hit.headers.get("ETag") } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Range"), `bytes 17-70001/${zip.length}`);
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), zip.slice(17, 70002));
  const stale = await request(path, { headers: { Range: "bytes=0-2", "If-Range": '"old"' } });
  assert.equal(stale.status, 200);
  assert.deepEqual(new Uint8Array(await stale.arrayBuffer()), zip);
  const head = await request(path, { method: "HEAD" });
  assert.equal(head.headers.get("Content-Length"), String(zip.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.deepEqual(await (await request("/__conditional", { method: "POST" })).json(), { hasBody: false });
  console.log("Small ZIP workerd/R2 contracts passed; checking streamed 285 MB ZIP and segmented Range reuse.");
  assert.equal((await request("/__setup-big", { method: "POST" })).status, 200);
  await request("/__clear-cache", { method: "POST" });
  const bigPath = "/api/archive-versions/2/download";
  const tailStart = 99_957_091;
  const big = await request(bigPath);
  assert.equal(big.status, 200);
  const bigZip = await digestResponse(big, tailStart, true);
  assert.equal(big.headers.get("Content-Length"), String(bigZip.size));
  assert.ok(bigZip.size > 256 * 1024 * 1024);
  await until(async () => {
    const objects = await (await request("/__cache")).json();
    assert.ok(objects.every(o => o.size <= downloadCacheMaxBytes));
    return objects.reduce((n, o) => n + o.size, 0) === bigZip.size;
  }, "segmented R2 PUT");
  const bigHit = await request(bigPath);
  assert.equal(bigHit.headers.get("X-Download-Cache-Tier"), "r2-segments");
  assert.equal(bigHit.headers.get("X-Download-Cache"), "HIT");
  assert.deepEqual(await digestResponse(bigHit, tailStart), bigZip);
  await request("/__clear-cache", { method: "POST" });
  const coldTail = await request(bigPath, { headers: { Range: `bytes=${tailStart}-` } });
  assert.equal(coldTail.headers.get("Content-Length"), String(bigZip.size - tailStart));
  assert.equal(coldTail.status, 206);
  assert.equal((await digestResponse(coldTail)).hash, bigZip.tail);
  await until(async () => (await (await request("/__cache")).json()).reduce((n, o) => n + o.size, 0) === bigZip.size-tailStart, "Range-only R2 PUT");
  const cachedTail = await request(bigPath, { headers: { Range: `bytes=${tailStart}-` } });
  assert.equal(cachedTail.status, 206);
  assert.equal(cachedTail.headers.get("X-Download-Cache-Tier"), "r2-segments");
  assert.equal(cachedTail.headers.get("Content-Range"), `bytes ${tailStart}-${bigZip.size-1}/${bigZip.size}`);
  assert.equal((await digestResponse(cachedTail)).hash, bigZip.tail);
  const partialHead = await request(bigPath, { method: "HEAD" });
  assert.equal(Number(partialHead.headers.get("Content-Length")), bigZip.size);
  const afterPartial = await request(bigPath);
  assert.equal(afterPartial.status, 200);
  assert.equal(afterPartial.headers.get("X-Download-Cache"), "MISS");
  assert.deepEqual(await digestResponse(afterPartial, tailStart), bigZip);
  succeeded = true;
  console.log(`Download cache workerd/R2 contracts passed: full/partial PUT and HIT, conditional Range, If-Range, HEAD, first-request admission, partial-to-full fallback (${zip.length} and ${bigZip.size} ZIP bytes).`);
} catch (error) {
  writeFileSync(join(temp, "worker.log"), log);
  console.error(`Runtime evidence retained at ${temp}\n${log.slice(-4000)}`);
  throw error;
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
  // This script owns only the directory returned by mkdtemp above.
  if (succeeded && relative(tmpdir(), temp).startsWith("viprpg-download-cache-")) await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
