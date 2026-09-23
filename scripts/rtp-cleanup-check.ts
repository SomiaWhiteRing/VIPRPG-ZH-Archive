import assert from "node:assert/strict";
import catalog from "../lib/archive/rtp-catalog.json";
import { isExactRtpFile, LcfReferenceScan, RtpReferenceScan, validateRtpCleanupReport, type RtpFile } from "../lib/archive/rtp-cleanup";
import { isResourceCleanupCandidate, ResourceReferenceScan, validateResourceCleanupReport } from "../lib/archive/resource-cleanup";

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
function integer(value: number): Uint8Array {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return Uint8Array.from(bytes);
}
const block = (id: number, data: Uint8Array) => concat(integer(id), integer(data.length), data);
const structure = (...fields: Uint8Array[]) => concat(...fields, integer(0));
const array = (data: Uint8Array) => concat(integer(1), integer(1), data);
const header = (value: string) => concat(integer(text(value).length), text(value));
const ldb = (...fields: Uint8Array[]) => concat(header("LcfDataBase"), ...fields);
const lmt = concat(header("LcfMapTree"), integer(0), integer(0), integer(0), integer(0));
const command = (code: number, name = "", parameters: number[] = []) => concat(integer(code), integer(0), integer(text(name).length), text(name), integer(parameters.length), ...parameters.map(integer));
const commands = (...values: Uint8Array[]) => concat(...values, new Uint8Array(4));
function candidate(directory: string, except = ""): RtpFile {
  const row = catalog.entries.find(([path]) => typeof path === "string" && path.startsWith(directory + "/") && !path.endsWith("/" + except) && /^[\x20-\x7e]+$/.test(path))!;
  assert.ok(row, directory);
  return { path: row[0] as string, size: row[1] as number, sha256: row[2] as string };
}
const sound = candidate("sound"), face = candidate("faceset"), charset = candidate("charset", face.path.split("/")[1]);
const name = (file: RtpFile) => file.path.split("/")[1].replace(/\.[^.]+$/, "");
const blank = { path: "RPG_RT.lmt", size: lmt.length, sha256: "0".repeat(64) };
function scan(database: Uint8Array, more: RtpFile[] = [], map?: Uint8Array) {
  const files = [sound, face, charset, blank, { ...blank, path: "RPG_RT.ldb", size: database.length }, ...more];
  if (map) files.push({ ...blank, path: "Map0001.lmu", size: map.length });
  const scanner = new RtpReferenceScan(files);
  scanner.consume("RPG_RT.ldb", database);
  scanner.consume("RPG_RT.lmt", lmt);
  if (map) scanner.consume("Map0001.lmu", map);
  return scanner.finish();
}
const modified = { ...sound, sha256: "1".repeat(64) };
const renamed = { ...sound, path: "Sound/my-custom-copy.wav" };
assert.equal(isExactRtpFile(modified), false);
assert.equal(isExactRtpFile(renamed), false);
const unused = scan(ldb(), [modified, renamed]);
assert.deepEqual(unused.excluded.map((file) => file.path).sort(), [sound.path, face.path, charset.path].sort());
validateRtpCleanupReport(unused);
assert.throws(() => validateRtpCleanupReport({ ...unused, excluded: [modified] }));
assert.throws(() => validateRtpCleanupReport({ ...unused, excluded: [sound, sound] }));
// Even an unused database actor's face must survive.
const dbReference = scan(ldb(block(11, array(structure(block(15, text(name(face))))))));
assert.ok(!dbReference.excluded.some((file) => file.path === face.path));
// A movement route embeds filename bytes inside the event's integer parameters.
const routeBytes = concat(integer(34), integer(text(name(charset)).length), text(name(charset)), integer(0));
const routeEvent = command(11330, "", [10001, 3, 0, 0, ...routeBytes]);
const page = structure(block(52, commands(routeEvent, command(11550, name(sound), [100, 100, 50]))));
const map = concat(header("LcfMapUnit"), structure(block(81, array(structure(block(5, array(page)))))));
const mapReference = scan(ldb(), [], map);
assert.deepEqual(mapReference.excluded.map((file) => file.path), [face.path]);
// Common events, including string-variable sound names, protect their directory.
const common = (event: Uint8Array) => ldb(block(25, array(structure(block(22, commands(event))))));
const dynamic = scan(common(command(11550, "", [100, 100, 50, 1, 7])));
assert.ok(dynamic.protectedDirectories.includes("sound"));
assert.ok(!dynamic.excluded.some((file) => file.path === sound.path));
for (const data of [common(command(99999)), ldb(block(999, text("unknown"))), new Uint8Array([11])]) {
  const report = scan(data);
  assert.equal(report.status, "preserved");
  assert.equal(report.excluded.length, 0);
}
assert.equal(scan(ldb(), [{ ...blank, path: "DynRPG/plugin.dll" }]).excluded.length, 0);
assert.equal(scan(common(command(11550, "@plugin-load"))).excluded.length, 0);
// Widening the experimental candidate set must still honor references and unknowns.
const customReferenced = { ...modified, path: "Sound/custom-referenced.wav" };
const customUnused = { ...modified, path: "Picture/custom-unused.png" };
for (const unknown of [false, true]) {
  const database = common(command(unknown ? 99999 : 11550, "custom-referenced", [100, 100, 50]));
  const files = [customReferenced, customUnused, blank, { ...blank, path: "RPG_RT.ldb", size: database.length }];
  const experiment = new LcfReferenceScan(files, (file) => /\.(?:wav|png)$/.test(file.path));
  const production = new ResourceReferenceScan(files);
  const rtpOnly = new RtpReferenceScan(files);
  for (const scanner of [experiment, production, rtpOnly]) {
    scanner.consume("RPG_RT.ldb", database);
    scanner.consume("RPG_RT.lmt", lmt);
  }
  assert.deepEqual(experiment.finish().excluded.map((file) => file.path), unknown ? [] : [customUnused.path]);
  assert.deepEqual(production.finish().excluded, experiment.finish().excluded);
  validateResourceCleanupReport(production.finish());
  assert.equal(rtpOnly.finish().excluded.length, 0, "RTP comparison mode never prunes custom media");
}
for (const path of ["RPG_RT.ldb", "Map0001.lmu", "RPG_RT.ini", "Player.exe", "Font/Font.ttf", "Logo/LOGO1.png", "readme.txt", "StringScripts/Map0001.txt", "Picture/../RPG_RT.ini", "Picture/./a.png", "Picture//a.png", "Picture/a.png\u0000", "Picture/a:b.png"]) {
  assert.equal(isResourceCleanupCandidate({ path }), false, path);
}
const fullScanner = new ResourceReferenceScan([customUnused, blank, { ...blank, path: "RPG_RT.ldb" }]);
fullScanner.consume("RPG_RT.ldb", ldb());
fullScanner.consume("RPG_RT.lmt", lmt);
const validFull = fullScanner.finish();
validateResourceCleanupReport(validFull);
assert.throws(() => validateResourceCleanupReport({ ...validFull, excluded: [{ ...customUnused, path: "RPG_RT.ldb" }] }));
assert.throws(() => validateResourceCleanupReport({ ...validFull, excluded: [{ ...customUnused, sha256: "bad" }] }));
assert.throws(() => validateResourceCleanupReport({ ...validFull, status: "preserved" }));
assert.throws(() => validateResourceCleanupReport({ ...validFull, version: "old" }));
console.log("RTP cleanup boundaries passed: exact identity, non-RTP preservation, database/map/move/common-event references, dynamic and unknown fallback, invalid reports.");
