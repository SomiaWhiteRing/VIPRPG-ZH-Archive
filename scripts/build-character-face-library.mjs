import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const sourcePath = resolve(
  args.source || ".wrangler/tmp/atwiki-face-source-downloaded.json",
);
const dictionaryPath = resolve(args.dictionary || "data/character-dictionary.json");
const outputDirectory = resolve(args.output || "data/character-face-sheets");
const assetDirectory = join(outputDirectory, "assets");
const manifestPath = join(outputDirectory, "manifest.json");

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));
if (dictionary.schema !== "viprpg-character-dictionary.v1") {
  throw new Error("角色词典格式不受支持");
}
if (
  source.schema !== "viprpg-atwiki-face-source-downloaded.v2" ||
  !Array.isArray(source.images) ||
  source.images.some((image) => !Number.isSafeInteger(image.sourceOrder) || image.sourceOrder < 0)
) {
  throw new Error("atwiki 脸图来源清单格式不合法");
}

mkdirSync(assetDirectory, { recursive: true });
const characters = dictionary.characters.map((character, index) => ({
  id: index + 1,
  originalName: character.originalName,
  names: [
    character.originalName,
    ...character.aliases
      .filter((alias) => alias.language === "ja")
      .map((alias) => alias.name),
  ],
}));
const bySha = new Map();
const matchNames = characters.flatMap((character) =>
  character.names.map((name) => ({
    character,
    key: normalize(name),
  })),
);

for (const image of source.images) {
  const localPath = image.localPath ? resolve(image.localPath) : null;
  if (!localPath || !existsSync(localPath)) {
    throw new Error(`缺少已下载原图：${image.src}`);
  }
  const bytes = readFileSync(localPath);
  const dimensions = readImageDimensions(bytes);
  if (
    dimensions.width !== Number(image.width) ||
    dimensions.height !== Number(image.height) ||
    dimensions.width < 48 ||
    dimensions.height < 48 ||
    dimensions.width > 192 ||
    dimensions.height > 192 ||
    dimensions.width % 48 !== 0 ||
    dimensions.height % 48 !== 0
  ) {
    throw new Error(`脸图尺寸不合法：${image.src}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const targetPath = join(assetDirectory, `${sha256}.${dimensions.extension}`);
  if (!existsSync(targetPath)) copyFileSync(localPath, targetPath);

  const matches = findCharacterMatches(image, matchNames);
  const matchedCharacters = matches.map((match) => match.originalName);
  const existing = bySha.get(sha256);
  if (existing) {
    existing.sources.push(sourceRecord(image));
    existing.sourceOrder = Math.min(existing.sourceOrder, image.sourceOrder);
    for (const { originalName, priority } of matches) {
      existing.bindingPriorities[originalName] = Math.min(
        existing.bindingPriorities[originalName] ?? 99,
        priority,
      );
    }
    existing.boundOriginalNames = Object.keys(existing.bindingPriorities);
    continue;
  }
  bySha.set(sha256, {
    sha256,
    file: `assets/${sha256}.${dimensions.extension}`,
    contentType: dimensions.contentType,
    sizeBytes: statSync(localPath).size,
    width: dimensions.width,
    height: dimensions.height,
    sourceOrder: image.sourceOrder,
    sources: [sourceRecord(image)],
    boundOriginalNames: matchedCharacters,
    bindingPriorities: Object.fromEntries(
      matches.map(({ originalName, priority }) => [originalName, priority]),
    ),
  });
}

const sheets = [...bySha.values()].sort((left, right) =>
  left.sourceOrder - right.sourceOrder || left.sha256.localeCompare(right.sha256),
);
for (const [index, sheet] of sheets.entries()) sheet.sourceOrder = index;
const defaultByCharacter = new Map();
for (const sheet of sheets.slice().sort((left, right) =>
  Math.min(...Object.values(left.bindingPriorities), 99) -
    Math.min(...Object.values(right.bindingPriorities), 99) ||
  left.sources[0].pageUrl.localeCompare(right.sources[0].pageUrl) ||
  left.sha256.localeCompare(right.sha256),
)) {
  for (const originalName of sheet.boundOriginalNames) {
    const priority = sheet.bindingPriorities[originalName] ?? 99;
    const current = defaultByCharacter.get(originalName);
    if (!current || priority < current.matchPriority) {
      defaultByCharacter.set(originalName, {
        originalName,
        sha256: sheet.sha256,
        row: 0,
        column: 0,
        confidence: "rough",
        matchPriority: priority,
      });
    }
  }
}
const manifest = {
  schema: "viprpg-character-face-library.v2",
  sourceSite: "https://w.atwiki.jp/viprpg_sozai/",
  cellSize: 48,
  generatedAt: new Date().toISOString(),
  sheets,
  defaults: [...defaultByCharacter.values()]
    .map((value) => ({
      originalName: value.originalName,
      sha256: value.sha256,
      row: value.row,
      column: value.column,
      confidence: value.confidence,
    }))
    .sort((left, right) => left.originalName.localeCompare(right.originalName, "ja")),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  sourceImages: source.images.length,
  uniqueSheets: sheets.length,
  bindings: sheets.reduce((count, sheet) => count + sheet.boundOriginalNames.length, 0),
  defaultCharacters: manifest.defaults.length,
  unmatchedSheets: sheets.filter((sheet) => sheet.boundOriginalNames.length === 0).length,
  manifestPath,
}, null, 2));

function sourceRecord(image) {
  return {
    pageUrl: image.pageUrl,
    pageTitle: image.pageTitle,
    imageUrl: image.src,
    sectionTitle: [image.h3, image.h4, image.h5].filter(Boolean).join(" / ") || null,
    originalFilename: decodeURIComponent(basename(new URL(image.src).pathname)),
  };
}

function findCharacterMatches(image, names) {
  const candidates = [
    ...(image.labels ?? []).map((value) => ({ value, priority: 0 })),
    ...[image.h5, image.h4, image.h3, image.h2].filter(Boolean).map((value) => ({ value, priority: 1 })),
    { value: image.pageTitle, priority: 2 },
  ];
  const matches = new Map();
  for (const candidate of candidates) {
    for (const candidateKey of contextKeys(candidate.value)) {
      if (!candidateKey || isGenericContext(candidateKey)) continue;
      for (const { character, key } of names) {
        if (!key) continue;
        const exact = key === candidateKey;
        const contains = key.length >= 4 && candidateKey.includes(key) &&
          containsOnBoundary(candidateKey, key);
        if (!exact && !contains) continue;
        const current = matches.get(character.originalName);
        if (current === undefined || candidate.priority < current) {
          matches.set(character.originalName, candidate.priority);
        }
      }
    }
  }
  const bestPriority = Math.min(...matches.values(), 99);
  return [...matches]
    .filter(([, priority]) => priority === bestPriority)
    .map(([originalName, priority]) => ({ originalName, priority }));
}

function containsOnBoundary(context, name) {
  if (context === name) return true;
  const index = context.indexOf(name);
  if (index < 0) return false;
  const prefix = context.slice(0, index);
  const suffix = context.slice(index + name.length);
  return (!prefix || /^(?:200[03]|xp|vx|vxa|mv|mz)$/iu.test(prefix)) &&
    (!suffix || /^(?:子|娘|様|博士|改変|顔)$/u.test(suffix));
}

function isGenericContext(value) {
  return /^(?:顔グラ|複数|全員|その他|未分類|差分多数|差分少量)$/u.test(value);
}

function contextKeys(value) {
  const raw = String(value ?? "").trim();
  const parts = [raw];
  for (const match of raw.matchAll(/[（(]([^）)]+)[）)]/gu)) parts.push(match[1]);
  parts.push(raw.replace(/[（(][^）)]+[）)]/gu, ""));
  for (const part of parts.slice()) {
    parts.push(...part.split(/[＆&／/、,＋+｜|]/gu));
  }
  return unique(parts.map(normalize).filter(Boolean));
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s・･()（）［］\[\]【】「」『』_\-]/gu, "")
    .toLowerCase();
}

function readImageDimensions(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    return {
      extension: "png",
      contentType: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
    return {
      extension: "bmp",
      contentType: "image/bmp",
      width: Math.abs(bytes.readInt32LE(18)),
      height: Math.abs(bytes.readInt32LE(22)),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const { width, height } = readJpegDimensions(bytes);
    return { extension: "jpg", contentType: "image/jpeg", width, height };
  }
  throw new Error("素材文件不是支持的 PNG、BMP 或 JPEG");
}

function readJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG 缺少尺寸信息");
}

function unique(values) {
  return [...new Set(values)];
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    result[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return result;
}
