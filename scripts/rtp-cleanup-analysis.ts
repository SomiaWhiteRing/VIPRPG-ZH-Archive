import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { classifyArchivePath } from "../lib/archive/file-policy";
import { isExactRtpFile, RtpReferenceScan, type RtpFile } from "../lib/archive/rtp-cleanup";

const game = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? "output/rtp-cleanup");
assert.notEqual(game, output);
assert.ok(!output.startsWith(game + "/") && !output.startsWith(game + "\\"));
mkdirSync(output, { recursive: true });
const entries: Array<RtpFile & { bytes: Uint8Array; core: boolean }> = [];
const source: Record<string, Uint8Array> = {};
const sourceStart = performance.now();
let sourceCount = 0, sourceBytes = 0;
function visit(directory: string, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) { visit(absolute, path + "/"); continue; }
    if (!entry.isFile()) continue;
    sourceCount++;
    sourceBytes += statSync(absolute).size;
    const policy = classifyArchivePath(path);
    if (!policy.included) continue;
    const bytes = readFileSync(absolute);
    source[path] = bytes;
    entries.push({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), bytes, core: policy.storageKind === "core_pack" });
  }
}
visit(game);
const readAndHashMs = performance.now() - sourceStart;
function analyze() {
  const start = performance.now();
  const scan = new RtpReferenceScan(entries);
  for (const file of entries) scan.consume(file.path, file.bytes);
  return { report: scan.finish(), ms: performance.now() - start };
}
const first = analyze();
const samples = Array.from({ length: 5 }, analyze);
for (const sample of samples) assert.deepEqual(sample.report, first.report);
const removed = new Set(first.report.excluded.map((file) => file.path));
assert.ok(first.report.excluded.every(isExactRtpFile), "only exact RTP bytes may be excluded");
const retained = entries.filter((file) => !removed.has(file.path));
for (const file of entries.filter((file) => !isExactRtpFile(file))) assert.ok(retained.includes(file));
const coreStart = performance.now();
const core = zipSync(Object.fromEntries(entries.filter((file) => file.core).map((file) => [file.path, file.bytes])), { level: 1 });
const corePackMs = performance.now() - coreStart;
function stats(files: typeof entries) {
  const blobs = new Map(files.filter((file) => !file.core).map((file) => [file.sha256, file.size]));
  const zipStart = performance.now();
  const zip = zipSync(Object.fromEntries(files.map((file) => [file.path, file.bytes])), { level: 0 });
  return { fileCount: files.length, bytes: files.reduce((n, f) => n + f.size, 0), uniqueBlobs: blobs.size,
    uploadBytes: [...blobs.values()].reduce((n, s) => n + s, core.length), corePackBytes: core.length,
    zipBytes: zip.length, zipBuildMs: performance.now() - zipStart };
}
const report = { game, at: new Date().toISOString(), sourceCount, sourceBytes, readAndHashMs,
  analysisColdMs: first.ms, analysisWarmMs: samples.map((s) => s.ms), corePackMs,
  before: stats(entries), after: stats(retained), cleanup: first.report };
writeFileSync(join(output, "analysis.json"), JSON.stringify(report, null, 2));
writeFileSync(join(output, "source.zip"), zipSync(source, { level: 0 }));
console.log(JSON.stringify({ ...report, cleanup: { ...first.report, excluded: `${removed.size} files (see analysis.json)` } }, null, 2));
