import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { classifyArchivePath } from "../lib/archive/file-policy";
import { isExactRtpFile, RtpReferenceScan, type RtpFile } from "../lib/archive/rtp-cleanup";
import type { ResourceReferenceReport } from "../lib/archive/lcf-reference-scan";
import { isResourceCleanupCandidate, ResourceReferenceScan } from "../lib/archive/resource-cleanup";
import { shouldSkipWebPlayLocalWrite } from "../lib/archive/web-play-local-policy";

// This command only writes separate experimental ZIPs, never the game's files.
// Core, executable, font, logo, readme and translation files have implicit uses;
// candidates are media in the standard engine resource directories only.
const isMediaCandidate = isResourceCleanupCandidate;
assert.ok(process.argv[2], "usage: tsx scripts/resource-cleanup-experiment.ts <game directory> <output directory>");
const game = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? "output/resource-cleanup-experiment");
const outputRelative = relative(game, output);
assert.ok(outputRelative && (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith("..\\") || outputRelative.startsWith("../")), "output must be outside the game directory");
mkdirSync(output, { recursive: true });
type Entry = RtpFile & { bytes: Uint8Array; core: boolean };
const entries: Entry[] = [];
const originalIndex: RtpFile[] = [];
const readStart = performance.now();
function visit(directory: string, prefix = "") {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix + item.name;
    const absolute = join(directory, item.name);
    if (item.isDirectory()) { visit(absolute, path + "/"); continue; }
    assert.ok(item.isFile(), `unsupported source entry: ${absolute}`);
    const bytes = readFileSync(absolute);
    const file = { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    originalIndex.push(file);
    const policy = classifyArchivePath(path);
    if (policy.included) entries.push({ ...file, bytes, core: policy.storageKind === "core_pack" });
  }
}
visit(game);
const readAndHashMs = performance.now() - readStart;
function analyze(scope: "rtp" | "all") {
  const start = performance.now();
  const scan = scope === "rtp" ? new RtpReferenceScan(entries) : new ResourceReferenceScan(entries);
  for (const file of entries) scan.consume(file.path, file.bytes);
  return { report: scan.finish(), ms: performance.now() - start };
}
const cold = { rtp: analyze("rtp"), all: analyze("all") };
const warm = { rtp: [] as number[], all: [] as number[] };
// Alternate the order to reduce consistent warm-up bias.
for (let i = 0; i < 6; i++) {
  for (const scope of i % 2 ? ["all", "rtp"] as const : ["rtp", "all"] as const) {
    const result = analyze(scope);
    assert.deepEqual(result.report, cold[scope].report);
    warm[scope].push(result.ms);
  }
}
const rtpRemoved = new Set(cold.rtp.report.excluded.map((file) => file.path));
const allRemoved = new Set(cold.all.report.excluded.map((file) => file.path));
assert.ok([...rtpRemoved].every((path) => allRemoved.has(path)), "all-resource mode should include the RTP exclusions");
assert.ok(cold.all.report.excluded.every(isMediaCandidate), "implicit engine files cannot be pruned");
const core = zipSync(Object.fromEntries(entries.filter((file) => file.core).map((file) => [file.path, file.bytes])), { level: 1 });
function outputVariant(mode: "original" | "rtp" | "all", cleanup: ResourceReferenceReport | null) {
  const removed = new Set(cleanup?.excluded.map((file) => file.path));
  const kept = entries.filter((file) => !removed.has(file.path));
  const blobs = new Map(kept.filter((file) => !file.core).map((file) => [file.sha256, file.size]));
  const beforeZip = performance.now();
  const zip = zipSync(Object.fromEntries(kept.map((file) => [file.path, file.bytes])), { level: 0 });
  const zipBuildMs = performance.now() - beforeZip;
  const zipPath = join(output, `${mode}.zip`);
  writeFileSync(zipPath, zip);
  // Validate the produced artifact, not only the in-memory selection.
  const extracted = unzipSync(readFileSync(zipPath));
  assert.deepEqual(Object.keys(extracted).sort(), kept.map((file) => file.path).sort());
  for (const file of kept) assert.equal(createHash("sha256").update(extracted[file.path]).digest("hex"), file.sha256, file.path);
  for (const file of entries.filter((file) => !isMediaCandidate(file))) assert.ok(extracted[file.path], `preserve engine/metadata ${file.path}`);
  const groups: Record<string, { count: number; bytes: number; additionalToRtp: number }> = {};
  for (const file of cleanup?.excluded ?? []) {
    const group = file.path.split("/")[0].toLowerCase();
    const data = groups[group] ??= { count: 0, bytes: 0, additionalToRtp: 0 };
    data.count++; data.bytes += file.size;
    if (!rtpRemoved.has(file.path)) data.additionalToRtp++;
  }
  return { zipPath, zipSha256: createHash("sha256").update(zip).digest("hex"), zipBytes: zip.length, zipBuildMs,
    fileCount: kept.length, bytes: kept.reduce((sum, file) => sum + file.size, 0),
    uniqueBlobs: blobs.size, uploadBytes: [...blobs.values()].reduce((sum, size) => sum + size, core.length), corePackBytes: core.length,
    opfsPackBytes: kept.filter((file) => !shouldSkipWebPlayLocalWrite(file.path)).reduce((sum, file) => sum + file.size, 0),
    groups, cleanup };
}
const original = outputVariant("original", null);
const rtp = outputVariant("rtp", cold.rtp.report);
const all = outputVariant("all", cold.all.report);
const byHash = new Map<string, Entry[]>();
for (const file of entries) byHash.set(file.sha256, [...byHash.get(file.sha256) ?? [], file]);
const additional = cold.all.report.excluded.filter((file) => !rtpRemoved.has(file.path)).map((file) => ({ ...file,
  sameContentAsExactRtp: (byHash.get(file.sha256) ?? []).some(isExactRtpFile),
}));
const report = { testedAt: new Date().toISOString(), game, scope: "all standard engine media, conservative static references; no reachability analysis",
  originalIndex, readAndHashMs, analysisColdMs: { rtp: cold.rtp.ms, all: cold.all.ms }, analysisWarmMs: warm,
  original, rtp, all, additional, originalSourceUnchanged: false };
// Re-read every original file to confirm this command left the input untouched.
for (const file of originalIndex) assert.equal(createHash("sha256").update(readFileSync(join(game, file.path))).digest("hex"), file.sha256, file.path);
report.originalSourceUnchanged = true;
writeFileSync(join(output, "comparison.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ game, readAndHashMs, analysisColdMs: report.analysisColdMs, analysisWarmMs: warm,
  variants: [original, rtp, all].map(({ cleanup, groups, ...variant }) => ({ ...variant, status: cleanup?.status, reasons: cleanup?.reasons, groups })),
  additionalCount: additional.length, additionalSameAsRtp: additional.filter((file) => file.sameContentAsExactRtp).length,
  originalSourceUnchanged: report.originalSourceUnchanged }, null, 2));
