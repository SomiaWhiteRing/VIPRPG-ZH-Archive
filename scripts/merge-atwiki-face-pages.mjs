import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const browserDirectory = resolve(
  process.argv[2] || ".wrangler/tmp/atwiki-face-pages",
);
const sourcePath = resolve(
  process.argv[3] || ".wrangler/tmp/atwiki-face-pages.json",
);
const outputPath = resolve(
  process.argv[4] || ".wrangler/tmp/atwiki-face-source.json",
);
const sourceData = JSON.parse(readFileSync(sourcePath, "utf8"));
const sourceByPageId = new Map(sourceData.pages.map((page) => [page.pageId, page]));
const images = [];

for (const name of readdirSync(browserDirectory).filter((value) => value.endsWith(".json"))) {
  const page = JSON.parse(readFileSync(resolve(browserDirectory, name), "utf8"));
  if (page.error) throw new Error(`脸图页面抓取失败：${page.pageId} ${page.error}`);
  const sourcePage = sourceByPageId.get(page.pageId);
  const labelsByFilename = new Map();
  for (const reference of sourcePage?.refs ?? []) {
    const values = labelsByFilename.get(reference.filename) ?? [];
    if (reference.itemLabel && !values.includes(reference.itemLabel)) {
      values.push(reference.itemLabel);
    }
    labelsByFilename.set(reference.filename, values);
  }
  for (const image of page.images ?? []) {
    const filename = decodeURIComponent(basename(new URL(image.src).pathname));
    images.push({
      ...image,
      pageId: page.pageId,
      pageUrl: page.pageUrl,
      pageTitle: page.pageTitle,
      labels: labelsByFilename.get(filename) ?? [],
    });
  }
}

const byUrl = new Map();
for (const image of images) {
  const existing = byUrl.get(image.src);
  if (existing) {
    existing.labels = [...new Set([...existing.labels, ...image.labels])];
  } else {
    byUrl.set(image.src, image);
  }
}
const uniqueImages = [...byUrl.values()].sort((left, right) =>
  left.pageId - right.pageId || left.src.localeCompare(right.src),
);
writeFileSync(
  outputPath,
  `${JSON.stringify({
    schema: "viprpg-atwiki-face-source.v1",
    images: uniqueImages,
  }, null, 2)}\n`,
);
console.log(JSON.stringify({
  pageRows: images.length,
  uniqueUrls: uniqueImages.length,
  labeledImages: uniqueImages.filter((image) => image.labels.length > 0).length,
  outputPath,
}, null, 2));
