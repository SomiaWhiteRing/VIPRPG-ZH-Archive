import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceDirectory = resolve(
  process.argv[2] || ".wrangler/tmp/atwiki-source-pages",
);
const outputPath = resolve(
  process.argv[3] || ".wrangler/tmp/atwiki-face-pages.json",
);
const pages = [];
const failures = [];

for (const name of readdirSync(sourceDirectory).filter((value) => value.endsWith(".json"))) {
  const page = JSON.parse(readFileSync(resolve(sourceDirectory, name), "utf8"));
  if (page.error || typeof page.source !== "string") {
    failures.push({
      pageId: page.pageId,
      pageTitle: page.pageTitle,
      error: page.error || "missing source",
    });
    continue;
  }
  const refs = parseFaceRefs(page.source);
  pages.push({
    pageId: page.pageId,
    pageUrl: page.pageUrl,
    pageTitle: page.pageTitle,
    refs,
  });
}

pages.sort((left, right) => left.pageId - right.pageId);
failures.sort((left, right) => left.pageId - right.pageId);
writeFileSync(
  outputPath,
  `${JSON.stringify({
    schema: "viprpg-atwiki-face-pages.v1",
    pages,
    failures,
  }, null, 2)}\n`,
);
console.log(JSON.stringify({
  parsedPages: pages.length,
  facePages: pages.filter((page) => page.refs.length > 0).length,
  faceRefs: pages.reduce((sum, page) => sum + page.refs.length, 0),
  failedPages: failures.length,
  outputPath,
}, null, 2));

function parseFaceRefs(source) {
  const headings = [];
  const refs = [];
  let faceLevel = null;
  let itemLabel = null;
  let faceOwner = null;

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const heading = /^(\*+)(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = cleanWikiText(heading[2]);
      if (faceLevel !== null && level <= faceLevel) {
        faceLevel = null;
        faceOwner = null;
      }
      headings.length = level - 1;
      headings[level - 1] = title;
      if (title.includes("顔グラ")) {
        faceLevel = level;
        itemLabel = null;
        faceOwner = headings.slice(0, Math.max(0, level - 1)).filter(Boolean).at(-1) ?? null;
      } else if (faceLevel !== null) {
        itemLabel = title;
      }
      continue;
    }
    if (faceLevel === null || !line || line.startsWith("//")) continue;
    const reference = parseImageReference(line);
    if (reference) {
      refs.push({
        filename: reference,
        sectionPath: headings.filter(Boolean),
        itemLabel: itemLabel ?? faceOwner,
      });
      continue;
    }
    if (
      !line.startsWith("#") &&
      !line.startsWith("-") &&
      !line.startsWith("|") &&
      !/^&\w/u.test(line)
    ) {
      itemLabel = cleanWikiText(line) || itemLabel;
    }
  }
  return refs;
}

function parseImageReference(line) {
  const match = /^#(?:ref|image)\((.+)\)\s*$/iu.exec(line);
  if (!match) return null;
  const png = /(?:^|,)((?:https?:)?[^,]*?\.png)(?=,|$)/iu.exec(match[1]);
  return png ? cleanWikiText(png[1]) : null;
}

function cleanWikiText(value) {
  return String(value ?? "")
    .replace(/\[\[([^>\]]+)>[^\]]+\]\]/gu, "$1")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/''|&color\([^)]*\)\{|\}/gu, "")
    .trim();
}
