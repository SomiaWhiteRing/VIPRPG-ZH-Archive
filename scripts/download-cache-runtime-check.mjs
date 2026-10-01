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
import { crc32 } from "../lib/archive/crc32.ts";

// Exercise FixedLengthStream -> Response.clone() -> R2.put and R2 conditional
// ranges in workerd. The bucket/state are temporary; no browser or remote API.
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
const objectKey = (kind, hash, suffix = "") => `${kind}/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${suffix}`;
const entry = `import { maybeHandleArchiveDownload } from ${JSON.stringify(relative(temp, resolve(root, "worker/archive-download.mjs")).replaceAll("\\", "/"))};
const record = ${JSON.stringify({ id: 1, work_id: 1, work_original_title: "Runtime fixture", manifest_sha256: manifestHash,
  packer_version: "fixture", total_size_bytes: bytes.length, estimated_r2_get_count: 1, uses_shared_player: 0, engine_family: "rpg_maker_2000" })};
const db = { prepare(sql) { return { bind() { return this; }, async run() { return {success:true}; }, async first() {
  return sql.includes('SELECT full_download_count') ? {full_download_count:2,size_bytes:${bytes.length}} : record;
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
  if (path === '/__conditional') {
    const listed = (await env.ARCHIVE_BUCKET.list({prefix:'download-cache/'})).objects[0];
    await env.ARCHIVE_BUCKET.put(listed.key, 'replaced');
    const result = await env.ARCHIVE_BUCKET.get(listed.key,{range:{offset:0,length:3},onlyIf:{etagMatches:listed.etag}});
    return Response.json({hasBody:Boolean(result?.body)});
  }
  return await maybeHandleArchiveDownload(request,{...env,DB:db},ctx) ?? new Response('',{status:404});
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
const request = (path, init = {}) => fetch(origin + path, { ...init, signal: AbortSignal.timeout(10_000) });
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
  succeeded = true;
  console.log(`Download cache workerd/R2 contracts passed: streamed PUT, full HIT, conditional Range, If-Range, HEAD (${zip.length} ZIP bytes).`);
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
