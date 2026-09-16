import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createSourceOrderReader } from "./character-material-source-order.mjs";
const { imageSize } = createRequire(import.meta.url)("next/dist/compiled/image-size");

// Resolve explicit source sections independently of the old face-anchor dictionary.
export function appendGeneratedCharacterMaterials(materials, faces) {
  const seed = JSON.parse(readFileSync("data/character-classification-bootstrap.json", "utf8"));
  const collection = resolve("output/playwright/character-materials");
  const readOrder = createSourceOrderReader(collection);
  const pages = new Map();
  const materialMap = new Map(materials.map((record) => [`${record.kind}:${record.sha256}`, record]));
  const faceMap = new Map(faces.sheets.map((record) => [record.sha256, record]));
  const missingPages = new Set();
  let references = 0;
  for (const assignment of seed.materialAssignments ?? []) {
    const pageId = /^https:\/\/w\.atwiki\.jp\/viprpg_sozai\/pages\/(\d+)\.html$/.exec(assignment.pageUrl)?.[1];
    if (!pageId) throw new Error(`Invalid source page: ${assignment.pageUrl}`);
    const file = resolve(collection, `${pageId}.json`);
    if (!existsSync(file)) { missingPages.add(assignment.pageUrl); continue; }
    if (!pages.has(pageId)) pages.set(pageId, JSON.parse(readFileSync(file, "utf8")));
    const page = pages.get(pageId);
    for (const item of page.images) {
      if (assignment.sectionPrefix && !item.sectionPath.some((part) => part.startsWith(assignment.sectionPrefix))) continue;
      if (assignment.filenames && !assignment.filenames.includes(item.filename)) continue;
      if (!item.file || !/^assets\/[a-f0-9]{64}\.(png|gif|jpg|bmp)$/.test(item.file)) throw new Error(`Download source image first: ${item.url}`);
      const bytes = readFileSync(resolve(collection, item.file));
      if (bytes.length !== item.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error(`Invalid cached asset: ${item.url}`);
      const sourceOrder = readOrder(page.url, item.url);
      const dimensions = imageSize(bytes);
      const { width, height } = dimensions;
      const isFace = item.kind === "faceset" && width >= 48 && height >= 48 && width <= 192 && height <= 192 && width % 48 === 0 && height % 48 === 0;
      const kind = item.kind === "faceset" && !isFace ? "other" : item.kind;
      const directory = isFace ? "data/character-face-sheets" : "data/character-materials";
      mkdirSync(resolve(directory, "assets"), { recursive: true });
      if (!existsSync(resolve(directory, item.file))) copyFileSync(resolve(collection, item.file), resolve(directory, item.file));
      const contentType = { png: "image/png", gif: "image/gif", jpg: "image/jpeg", bmp: "image/bmp" }[dimensions.type];
      const map = isFace ? faceMap : materialMap;
      const id = isFace ? item.sha256 : `${kind}:${item.sha256}`;
      if (!map.has(id)) {
        const record = { sha256: item.sha256, file: item.file, sizeBytes: item.sizeBytes, contentType, boundOriginalNames: [], sources: [],
          ...(isFace ? { width, height, sourceKind: "atwiki", sourceOrder, bindingPriorities: {} } : { kind }) };
        map.set(id, record);
        (isFace ? faces.sheets : materials).push(record);
      }
      const record = map.get(id);
      record.boundOriginalNames = [...new Set([...record.boundOriginalNames, ...assignment.originalNames])];
      const source = isFace
        ? { pageUrl: page.url, pageTitle: page.title, imageUrl: item.url, sectionTitle: item.sectionPath.join(" / "), originalFilename: item.filename }
        : { referenceId: createHash("sha256").update(JSON.stringify([page.url,item.sectionPath,item.kind,item.url])).digest("hex"), pageUrl: page.url, pageTitle: page.title, imageUrl: item.url, originalFilename: item.filename, sectionPath: item.sectionPath, sourceOrder, originalNames: assignment.originalNames, decision: "source_section" };
      const existingSource = record.sources.find((row) => row.pageUrl === page.url && row.imageUrl === item.url);
      if (!existingSource) record.sources.push(source);
      else if (!isFace) existingSource.originalNames = [...new Set([...existingSource.originalNames, ...assignment.originalNames])];
      if (isFace) {
        record.bindingPriorities ??= {};
        for (const name of assignment.originalNames) record.bindingPriorities[name] ??= 1;
      }
      references++;
    }
  }
  if (missingPages.size) throw new Error(`Collect source pages first: ${[...missingPages].join(", ")}`);
  const configuredPortraits = new Set(faces.defaults.map((portrait) => portrait.originalName));
  const missingDefaultPortraits = [...new Set(faces.sheets.flatMap((sheet) => sheet.boundOriginalNames))]
    .filter((name) => !configuredPortraits.has(name));
  if (missingDefaultPortraits.length) {
    console.warn(`脸图已关联但尚未选择默认格子（${missingDefaultPortraits.length}）：${missingDefaultPortraits.join("、")}。请在脸图清单 defaults 中明确选择；多人共用脸图不能统一取首格。`);
  }
  return { references, missingPages: [], missingDefaultPortraits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const materialPath = "data/character-materials/manifest.json";
  const facePath = "data/character-face-sheets/manifest.json";
  const materials = JSON.parse(readFileSync(materialPath, "utf8"));
  const faces = JSON.parse(readFileSync(facePath, "utf8"));
  const summary = appendGeneratedCharacterMaterials(materials.materials, faces);
  writeFileSync(materialPath, JSON.stringify(materials, null, 2) + "\n");
  writeFileSync(facePath, JSON.stringify(faces, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
