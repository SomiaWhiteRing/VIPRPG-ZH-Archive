import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.base || !args.sub) {
  throw new Error(
    "用法：node scripts/build-character-dictionary.mjs --base <base.csv> --sub <sub.csv> [--output <json>]",
  );
}

const outputPath = resolve(args.output || "data/character-dictionary.json");
const baseRows = characterRows(readCsv(resolve(args.base)));
const subRows = characterRows(readCsv(resolve(args.sub)));
const baseByOriginal = uniqueRows(baseRows, "base");
const parentByOriginal = new Map(
  baseRows
    .filter((row) => row["对应原名"].trim())
    .map((row) => [row["原文"].trim(), row["对应原名"].trim()]),
);

function canonicalOriginal(originalName) {
  let current = originalName;
  const seen = new Set();
  while (parentByOriginal.has(current)) {
    if (seen.has(current)) throw new Error(`角色对应原名形成循环：${originalName}`);
    seen.add(current);
    current = parentByOriginal.get(current);
    if (!baseByOriginal.has(current)) {
      throw new Error(`角色“${originalName}”指向不存在的对应原名“${current}”`);
    }
  }
  return current;
}

const characters = new Map();
for (const row of baseRows) {
  const originalName = canonicalOriginal(row["原文"].trim());
  if (characters.has(originalName)) continue;
  const root = baseByOriginal.get(originalName);
  const primaryName = root["译文"].trim();
  if (!primaryName) throw new Error(`角色“${originalName}”缺少基础译名`);
  characters.set(originalName, {
    originalName,
    primaryName,
    aliases: [],
    aliasKeys: new Set([nameKey(originalName), nameKey(primaryName)]),
  });
}

for (const row of baseRows) {
  const originalName = canonicalOriginal(row["原文"].trim());
  const character = characters.get(originalName);
  addAlias(character, row["原文"], "ja", "base");
  addAlias(character, row["译文"], "zh", "base");
}

let subAliasCount = 0;
for (const row of subRows) {
  const rowOriginal = row["原文"].trim();
  if (!baseByOriginal.has(rowOriginal)) continue;
  const character = characters.get(canonicalOriginal(rowOriginal));
  if (addAlias(character, row["译文"], "zh", "sub")) subAliasCount += 1;
}

const output = {
  schema: "viprpg-character-dictionary.v1",
  characters: [...characters.values()]
    .sort((left, right) => compareText(left.originalName, right.originalName))
    .map((character) => ({
      originalName: character.originalName,
      primaryName: character.primaryName,
      aliases: character.aliases.sort(
        (left, right) =>
          compareText(left.source, right.source) ||
          compareText(left.language, right.language) ||
          compareText(left.name, right.name),
      ),
    })),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `已生成 ${output.characters.length} 个角色、${output.characters.reduce((sum, item) => sum + item.aliases.length, 0)} 个别名，其中 ${subAliasCount} 个来自 sub 译名差异。`,
);

function addAlias(character, rawName, language, source) {
  const name = normalizeName(rawName);
  const key = nameKey(name);
  if (!key || character.aliasKeys.has(key)) return false;
  character.aliasKeys.add(key);
  character.aliases.push({ name, language, source });
  return true;
}

function characterRows(rows) {
  return rows.filter((row) => {
    const originalName = row["原文"]?.trim() || "";
    return originalName && !/^-{3,}.*-{3,}$/u.test(originalName);
  });
}

function uniqueRows(rows, label) {
  const result = new Map();
  for (const row of rows) {
    const originalName = row["原文"].trim();
    if (result.has(originalName)) {
      throw new Error(`${label} 角色表包含重复原文：${originalName}`);
    }
    result.set(originalName, row);
  }
  return result;
}

function readCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  const records = parseCsv(text);
  const headers = records.shift();
  for (const required of ["原文", "译文", "对应原名"]) {
    if (!headers?.includes(required)) throw new Error(`${path} 缺少“${required}”列`);
  }
  return records
    .filter((record) => record.some((value) => value !== ""))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function nameKey(value) {
  return normalizeName(value).toLowerCase();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--") || !values[index + 1]) continue;
    result[key.slice(2)] = values[index + 1];
    index += 1;
  }
  return result;
}
