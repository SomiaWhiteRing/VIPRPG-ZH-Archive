import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceOrderReader } from "./character-material-source-order.mjs";
import { appendGeneratedCharacterMaterials } from "./complete-character-source-materials.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const reviewDirectory = resolve(root, "output/character-material-review");
export const collectionDirectory = resolve(root, "output/playwright/character-materials");
export const libraryDirectory = resolve(root, "data/character-materials");
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}
export function referenceId(item) {
  return createHash("sha256").update(JSON.stringify([item.pageUrl, item.scope, item.kind, item.url])).digest("hex");
}
export function readInput() {
  const items = readJson(resolve(root, "output/character-material-association/materials.json"));
  const scopes = readJson(resolve(root, "output/character-material-association/scopes.json"));
  const characters = readJson(resolve(root, "data/character-dictionary.json")).characters;
  const generated = readJson(resolve(root, "data/character-classification-bootstrap.json")).newCharacters;
  for (const character of generated) {
    if (!characters.some((existing) => existing.originalName === character.originalName)) characters.push({ ...character, aliases: [] });
  }
  const decisionsPath = resolve(reviewDirectory, "decisions.json");
  const decisions = existsSync(decisionsPath) ? readJson(decisionsPath) : {};
  const ids = new Set();
  const uniqueItems = items.filter((item) => {
    item.id = referenceId(item);
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
  return { items: uniqueItems, scopes, characters, decisions };
}

export function buildLibrary() {
  const readSourceOrder = createSourceOrderReader(collectionDirectory);
  const { items, characters, decisions } = readInput();
  const explicitAssignments = readJson(resolve(root, "data/character-classification-bootstrap.json")).materialAssignments ?? [];
  const knownNames = new Set(characters.map((c) => c.originalName));
  const records = new Map();
  const counts = { automatic: 0, reviewed: 0, discardedNoAnchor: 0, rejected: 0, pending: 0 };
  mkdirSync(resolve(libraryDirectory, "assets"), { recursive: true });
  for (const item of items) {
    const explicitNames = [...new Set(explicitAssignments.filter((assignment) =>
      assignment.pageUrl === item.pageUrl && assignment.filenames?.includes(item.filename)
      && (!assignment.sectionPrefix || item.sectionPath.some((section) => section.startsWith(assignment.sectionPrefix)))
    ).flatMap((assignment) => assignment.originalNames))];
    if (!explicitNames.length && item.status === "no_face_anchor") { counts.discardedNoAnchor++; continue; }
    let names;
    if (explicitNames.length) { names = explicitNames; counts.automatic++; }
    else if (item.status === "single_anchor") { names = item.candidates; counts.automatic++; }
    else {
      const decision = decisions[item.id];
      if (decision?.action === "reject") { counts.rejected++; continue; }
      if (decision?.action !== "assign") { counts.pending++; continue; }
      names = decision.names;
      counts.reviewed++;
    }
    if (!Array.isArray(names) || !names.length || names.some((name) => !knownNames.has(name))) throw new Error(`Invalid character binding: ${item.id}`);
    if (!["charset", "monster", "other"].includes(item.kind)) throw new Error(`Invalid material kind: ${item.kind}`);
    if (!/^assets\/[a-f0-9]{64}\.(png|gif|jpg|bmp)$/.test(item.file)) throw new Error(`Invalid asset path: ${item.file}`);
    const bytes = readFileSync(resolve(collectionDirectory, item.file));
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256 || bytes.length !== item.sizeBytes) throw new Error(`Asset integrity mismatch: ${item.file}`);
    const destination = resolve(libraryDirectory, item.file);
    if (!existsSync(destination) || createHash("sha256").update(readFileSync(destination)).digest("hex") !== item.sha256) copyFileSync(resolve(collectionDirectory, item.file), destination);
    const key = `${item.kind}:${item.sha256}`;
    if (!records.has(key)) records.set(key, {
      sha256: item.sha256, kind: item.kind, file: item.file, sizeBytes: bytes.length,
      contentType: { png: "image/png", gif: "image/gif", jpg: "image/jpeg", bmp: "image/bmp" }[item.file.split(".").at(-1)],
      boundOriginalNames: [], sources: [],
    });
    const record = records.get(key);
    record.boundOriginalNames = [...new Set([...record.boundOriginalNames, ...names])].sort();
    record.sources.push({
      referenceId: item.id, pageUrl: item.pageUrl, pageTitle: item.pageTitle,
      imageUrl: item.url, originalFilename: item.filename, sectionPath: item.sectionPath,
      sourceOrder: readSourceOrder(item.pageUrl, item.url),
      originalNames: names, decision: explicitNames.length ? "source_section" : item.status === "single_anchor" ? "face_anchor" : "manual",
    });
  }
  const materials = [...records.values()].sort((a, b) => `${a.kind}:${a.sha256}`.localeCompare(`${b.kind}:${b.sha256}`));
  const facesPath = resolve(root, "data/character-face-sheets/manifest.json");
  const faces = readJson(facesPath);
  appendGeneratedCharacterMaterials(materials, faces);
  saveJson(facesPath, faces);
  const manifest = { schema: "viprpg-character-material-library.v1", materials };
  saveJson(resolve(libraryDirectory, "manifest.json"), manifest);
  const summary = { ...counts, materials: materials.length, uniqueFiles: new Set(materials.map((m) => m.sha256)).size, bindings: materials.reduce((n, m) => n + m.boundOriginalNames.length, 0) };
  saveJson(resolve(reviewDirectory, "build-summary.json"), summary);
  return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildLibrary(), null, 2));
