import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Reuse the visible atwiki CLI session; verification is always performed by a person.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "output/playwright/character-materials");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("node scripts/collect-character-materials.mjs [--open] [--all | --limit N] [--generated | --categories] [--download] [--assigned]\nDefault: collect one uncached source page. --generated limits collection to generated characters' sources; --categories limits collection to category sources. --assigned downloads only explicitly assigned images. --open opens the persistent browser for manual verification. Re-run to resume; output/playwright/character-materials holds the cache and report.");
  process.exit(0);
}
const limitIndex = args.indexOf("--limit");
const limit = args.includes("--all") ? Infinity : limitIndex < 0 ? 1 : Number(args[limitIndex + 1]);
if (!(limit > 0 && (Number.isInteger(limit) || limit === Infinity))) throw new Error("Invalid --limit");
mkdirSync(output, { recursive: true });
const npx = join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
if (!existsSync(npx)) throw new Error("Cannot locate npm/bin/npx-cli.js beside Node.js");
function cli(...arguments_) {
  const result = spawnSync(process.execPath, [npx, "--yes", "--package", "@playwright/cli", "playwright-cli", "-s=atwiki", ...arguments_], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.stdout.includes("### Error")) {
    throw new Error(result.error?.message || result.stderr || result.stdout);
  }
  return result.stdout;
}
function save(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}
async function withRetry(label, operation) {
  for (let attempt = 0; ; attempt++) {
    await delay(attempt ? 5000 * 2 ** (attempt - 1) : 1000);
    try {
      return await operation();
    } catch (error) {
      const message = String(error?.message ?? error);
      const transient = /timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_|HTTP (408|429|5\d\d)/i.test(message);
      if (!transient || /verification/i.test(message) || attempt >= 3) {
        throw new Error(`${label}: ${message}`, { cause: error });
      }
      console.warn(`[${new Date().toISOString()}] Retry ${attempt + 1}/3 in ${5 * 2 ** attempt}s: ${label}: ${message}`);
    }
  }
}
const library = JSON.parse(readFileSync(join(root, "data/character-face-sheets/manifest.json"), "utf8"));
const pages = new Map();
for (const sheet of library.sheets) {
  for (const source of sheet.sources) {
    if (!/^https:\/\/w\.atwiki\.jp\/viprpg_sozai\/pages\/\d+\.html$/.test(source.pageUrl)) continue;
    if (!pages.has(source.pageUrl)) pages.set(source.pageUrl, { url: source.pageUrl, names: new Set() });
    // These are candidates from face provenance, not verified charset bindings.
    for (const name of sheet.boundOriginalNames) pages.get(source.pageUrl).names.add(name);
  }
}
// Characters added from the index may have no face sheet yet. Their source pages
// must still be collected, otherwise the missing binding can never be filled.
const classification = JSON.parse(readFileSync(join(root, "data/character-classification-bootstrap.json"), "utf8"));
for (const source of classification.sources) {
  for (const url of source.urls) {
    if (!/^https:\/\/w\.atwiki\.jp\/viprpg_sozai\/pages\/\d+\.html$/.test(url)) continue;
    if (!pages.has(url)) pages.set(url, { url, names: new Set() });
    pages.get(url).names.add(source.characterName);
  }
}
const categoryUrls = new Set(classification.categories.map((category) => category.sourceUrl).filter((url) => /^https:\/\/w\.atwiki\.jp\/viprpg_sozai\/pages\/\d+\.html$/.test(url ?? "")));
for (const url of categoryUrls) if (!pages.has(url)) pages.set(url, { url, names: new Set() });
if (args.includes("--categories")) {
  for (const url of pages.keys()) if (!categoryUrls.has(url)) pages.delete(url);
} else if (args.includes("--generated")) {
  const generated = new Set(classification.newCharacters.map((character) => character.originalName));
  const urls = new Set(classification.sources.filter((source) => generated.has(source.characterName)).flatMap((source) => source.urls));
  for (const url of pages.keys()) if (!urls.has(url)) pages.delete(url);
}
if (args.includes("--open")) {
  console.log(cli("open", pages.keys().next().value, "--browser", "chrome", "--headed", "--persistent", "--profile", "output/playwright/atwiki-profile"));
  console.log("Complete any verification in the browser, then run this command without --open.");
  process.exit(0);
}

function collectPage() {
  const body = document.querySelector("#wikibody");
  if (!body) throw new Error("Source content unavailable; complete verification in the browser and rerun.");
  let section = "";
  let kind = null;
  const headings = [];
  const images = [];
  for (const element of body.querySelectorAll("h2,h3,h4,h5,h6,img")) {
    if (element.tagName !== "IMG") {
      section = element.textContent.trim();
      const level = Number(element.tagName.slice(1));
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      const headingKind = /キャラセット|歩行グラ/.test(section) ? "charset"
          : /顔グラ/.test(section) ? "faceset"
          : /モングラ/.test(section) ? "monster"
          : /ピクチャー|その他/.test(section) ? "other" : null;
      headings.push({ level, section, kind: headingKind });
      kind = headings.findLast((heading) => heading.kind)?.kind ?? null;
      continue;
    }
    if (!kind) continue;
    const url = element.src;
    if (!url.startsWith("https://img.atwiki.jp/viprpg_sozai/attach/")) continue;
    images.push({ kind, section, sectionPath: headings.map((heading) => heading.section), url, filename: decodeURIComponent(new URL(url).pathname.split("/").pop()), width: element.naturalWidth || element.width, height: element.naturalHeight || element.height });
  }
  return { collectionVersion: 4, url: location.href, title: document.querySelector("#pagetitle")?.textContent.trim(), collectedAt: new Date().toISOString(), images, html: body.outerHTML, documentHtml: '<!DOCTYPE html>\n' + document.documentElement.outerHTML };
}

let collected = 0;
const report = [];
try {
  for (const source of pages.values()) {
    const id = /\/(\d+)\.html$/.exec(source.url)[1];
    const path = join(output, `${id}.json`);
    const cached = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    if (cached?.collectionVersion !== 4 || !existsSync(join(output, `${id}.html`))) {
      if (collected >= limit) continue;
      const code = `async (page) => { const response = await page.goto(${JSON.stringify(source.url)}, {waitUntil:'domcontentloaded'}); if (response && !response.ok()) throw new Error('HTTP ' + response.status()); return await page.evaluate(${collectPage.toString()}); }`;
      const codePath = join(output, "collect-page.js");
      writeFileSync(codePath, code);
      const result = await withRetry(source.url, () => cli("run-code", "--filename", codePath));
      const match = /### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/.exec(result);
      if (!match) throw new Error(`No result for ${source.url}: ${result.slice(0, 500)}`);
      const page = JSON.parse(match[1]);
      if (page.url !== source.url) throw new Error(`Unexpected navigation: ${page.url}`);
      writeFileSync(join(output, `${id}.html.tmp`), page.documentHtml);
      renameSync(join(output, `${id}.html.tmp`), join(output, `${id}.html`));
      delete page.documentHtml;
      page.documentFile = `${id}.html`;
      const previousImages = new Map((cached?.images ?? []).map((image) => [image.url, image]));
      for (const image of page.images) {
        const previous = previousImages.get(image.url);
        if (previous?.file) {
          image.file = previous.file;
          image.sha256 = previous.sha256;
          image.sizeBytes = previous.sizeBytes;
        }
      }
      save(path, page);
      collected++;
      console.log(`Cached ${source.url}: ${page.images.length} images`);
    }
    const page = JSON.parse(readFileSync(path, "utf8"));
    const entry = { pageUrl: source.url, title: page.title, candidateOriginalNames: [...source.names], images: page.images };
    report.push(entry);
    if (args.includes("--download")) {
      mkdirSync(join(output, "assets"), { recursive: true });
      let selectedImageCount = 0;
      for (const material of page.images) {
        if (args.includes("--assigned") && !(classification.materialAssignments ?? []).some((assignment) =>
          assignment.pageUrl === page.url &&
          (!assignment.sectionPrefix || material.sectionPath.some((part) => part.startsWith(assignment.sectionPrefix))) &&
          (!assignment.filenames || assignment.filenames.includes(material.filename)))) continue;
        selectedImageCount++;
        if (material.file && existsSync(join(output, material.file))) {
          const bytes = readFileSync(join(output, material.file));
          if (createHash("sha256").update(bytes).digest("hex") === material.sha256) continue;
        }
        const { bytes, type } = await withRetry(material.url, async () => {
        let response = await fetch(material.url, { signal: AbortSignal.timeout(30_000) });
        if (response.status === 403) {
          const codePath = join(output, "download-image.js");
          writeFileSync(codePath, `async (page) => {
            const tab = await page.context().newPage();
            const response = await tab.goto(${JSON.stringify(material.url)}, {waitUntil:'domcontentloaded'});
            if (!response?.ok()) {
              const status = response?.status();
              if (status === 403) throw new Error('Complete image verification in the open tab, then rerun.');
              await tab.close();
              throw new Error('HTTP ' + status);
            }
            const result = {type: response.headers()['content-type'], base64: (await response.body()).toString('base64')};
            await tab.close();
            return result;
          }`);
          const result = cli("run-code", "--filename", codePath);
          const match = /### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/.exec(result);
          if (!match) throw new Error(`No browser download result: ${material.url}`);
          const image = JSON.parse(match[1]);
          response = new Response(Buffer.from(image.base64, "base64"), { headers: { "content-type": image.type } });
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = response.headers.get("content-type")?.split(";")[0];
        const bytes = Buffer.from(await response.arrayBuffer());
        return { bytes, type };
        });
        const extensions = { "image/png": "png", "image/gif": "gif", "image/jpeg": "jpg", "image/bmp": "bmp" };
        if (!extensions[type]) throw new Error(`Unexpected content type ${type}: ${material.url}`);
        if (!bytes.length) throw new Error(`Empty image: ${material.url}`);
        material.sha256 = createHash("sha256").update(bytes).digest("hex");
        material.file = `assets/${material.sha256}.${extensions[type]}`;
        material.sizeBytes = bytes.length;
        writeFileSync(join(output, material.file), bytes);
        save(path, page);
        console.log(`[${new Date().toISOString()}] Saved ${material.filename}: ${material.sizeBytes} bytes`);
      }
      console.log(`Downloaded ${selectedImageCount} selected images: ${page.title}`);
    }
  }
} finally {
  save(join(output, "report.json"), { sourcePages: pages.size, processedPages: report.length, pages: report });
}
console.log(`Done: ${collected} new pages; ${report.length}/${pages.size} cached pages. ${output}`);
