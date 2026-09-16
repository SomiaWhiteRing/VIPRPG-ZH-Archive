import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Read the saved wiki body, excluding navigation, thumbnails and source links.
export function createSourceOrderReader(directory = resolve("output/playwright/character-materials")) {
  const pages = new Map();
  return (pageUrl, imageUrl) => {
    if (!pages.has(pageUrl)) {
      const pageId = /^https:\/\/w\.atwiki\.jp\/viprpg_sozai\/pages\/(\d+)\.html$/.exec(pageUrl)?.[1];
      if (!pageId) throw new Error(`素材来源页面不受支持：${pageUrl}`);
      const page = JSON.parse(readFileSync(resolve(directory, `${pageId}.json`), "utf8"));
      if (page.url !== pageUrl || typeof page.html !== "string") throw new Error(`缺少源站 HTML：${pageUrl}`);
      const positions = new Map();
      for (const match of page.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const url = new URL(match[1].replaceAll("&amp;", "&"), pageUrl).href;
        if (!positions.has(url)) positions.set(url, positions.size);
      }
      pages.set(pageUrl, positions);
    }
    const order = pages.get(pageUrl).get(new URL(imageUrl).href);
    if (order === undefined) throw new Error(`源站 HTML 中找不到素材图片：${pageUrl} ${imageUrl}`);
    return order;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = resolve("data/character-materials/manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const readOrder = createSourceOrderReader();
  let sources = 0;
  for (const material of manifest.materials) {
    for (const source of material.sources) {
      source.sourceOrder = readOrder(source.pageUrl, source.imageUrl);
      sources++;
    }
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`已按源站 HTML 登记 ${sources} 条图片来源顺序。`);
}
