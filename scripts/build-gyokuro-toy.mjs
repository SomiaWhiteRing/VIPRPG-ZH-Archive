import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { easyRpgConfigArguments } from "../lib/archive/easyrpg-config.ts";
import { productionNetplayHongKongWork, productionNetplaySiteOrigin, stagingNetplaySiteOrigin } from "../lib/archive/netplay-ingress.ts";
import { shouldSkipWebPlayLocalWrite } from "../lib/archive/web-play-local-policy.ts";
import runtime from "../lib/archive/easyrpg-runtime.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const [target, outputArg] = process.argv.slice(2);
const site = {
  staging: { origin: stagingNetplaySiteOrigin, workId: 18 },
  production: { origin: productionNetplaySiteOrigin, workId: productionNetplayHongKongWork },
};
if (!Object.hasOwn(site, target) || !outputArg) {
  throw new Error("用法：node scripts/build-gyokuro-toy.mjs <staging|production> <新目录>");
}
const output = resolve(outputArg);

const { origin, workId } = site[target];
const response = await fetch(new URL(`/api/works/${workId}/web-play`, origin), { redirect: "error" });
if (!response.ok) throw new Error(`读取网页游玩元数据失败：HTTP ${response.status}`);
const metadata = await response.json();
if (metadata.workId !== workId || !Number.isSafeInteger(metadata.archiveVersionId) ||
    metadata.easyRpg?.netplay !== true || metadata.easyRpgRuntimeVersion !== runtime.version) {
  throw new Error("网站归档或运行包与本地 Toy 构建输入不一致");
}
const downloadUrl = new URL(metadata.downloadUrl, origin);
if (downloadUrl.origin !== origin ||
    downloadUrl.pathname !== `/api/archive-versions/${metadata.archiveVersionId}/download`) {
  throw new Error("归档下载地址不匹配");
}
const zip = await fetch(downloadUrl, { redirect: "error" });
if (!zip.ok) throw new Error(`读取游戏归档失败：HTTP ${zip.status}`);
const data = unzipSync(new Uint8Array(await zip.arrayBuffer()), {
  filter: ({ name }) => !name.endsWith("/") && !/\.(exe|dll)$/i.test(name) && !shouldSkipWebPlayLocalWrite(name),
});
const paths = Object.keys(data);
const files = [], parts = [];
let offset = 0;
for (const path of paths) {
  if (path.includes("\\") || path.includes("\0") ||
      path.split("/").some(part => !part || part === "." || part === ".." || Object.hasOwn(Object.prototype, part))) {
    throw new Error(`游戏归档包含无效路径：${path}`);
  }
  const bytes = Buffer.from(data[path].buffer, data[path].byteOffset, data[path].byteLength);
  files.push({ filename: `/${path}`, start: offset, end: offset + bytes.length });
  parts.push(bytes);
  offset += bytes.length;
}
if (!paths.some(path => /^rpg_rt\.ldb$/i.test(path)) || !paths.some(path => /^rpg_rt\.lmt$/i.test(path))) {
  throw new Error("游戏归档根目录缺少数据库或地图树");
}

await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await cp(join(root, "toy", "gyokuro"), output, { recursive: true });
const runtimePath = join(root, "public", "play", "runtime", "easyrpg", runtime.version);
const targetRuntime = join(output, "runtime");
for (const name of await readdir(runtimePath)) {
  if (name.endsWith(".br") || name === "game-services.js") continue;
  await cp(join(runtimePath, name), join(targetRuntime, name === "COPYING" ? "COPYING.md" : name.replace(/\.txt$/, ".md")));
}
await cp(join(root, "scripts", "easyrpg-game-services.js"), join(targetRuntime, "game-services.js"));
await cp(join(root, "public", "icon", "alex.png"), join(targetRuntime, "alex.png"));
await writeFile(join(output, "game.data"), Buffer.concat(parts, offset));
await writeFile(join(output, "config.js"), `export default ${JSON.stringify({
  siteOrigin: origin,
  archiveVersionId: metadata.archiveVersionId,
  arguments: [...easyRpgConfigArguments(metadata.easyRpg), "--skip-logo"],
  game: { files },
})};\n`);
console.log(`Toy 构建目录：${output}`);
