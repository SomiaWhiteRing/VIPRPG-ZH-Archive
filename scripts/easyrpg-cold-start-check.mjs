import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { deploymentOrigins } from "./deployment-config.mjs";

const { values } = parseArgs({ options: {
  env: { type: "string", default: "staging" },
  "work-id": { type: "string", default: "1" },
  report: { type: "string", default: "output/easyrpg/cold-start.json" },
  "disable-quic": { type: "boolean", default: false },
} });
assert.ok(Object.hasOwn(deploymentOrigins, values.env), "Unknown environment");
const workId = Number(values["work-id"]);
assert.ok(Number.isSafeInteger(workId) && workId > 0, "Invalid work ID");
const reportPath = resolve(values.report);
mkdirSync(dirname(reportPath), { recursive: true });
const errors = [], assetResponses = [];
const report = { passed: false, url: `${deploymentOrigins[values.env]}/play/${workId}` };
const runtime = JSON.parse(readFileSync("lib/archive/easyrpg-runtime.json", "utf8"));
const assetSizes = Object.fromEntries(["wasm", "data"].map(extension => [extension,
  statSync(`public/play/runtime/easyrpg/${runtime.version}/easyrpg-player.${extension}`).size]));
const browser = await chromium.launch({
  headless: true,
  ...(values["disable-quic"] ? { args: ["--disable-quic"] } : {}),
  ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(45_000);
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => {
  if (/\/easyrpg-player\.(wasm|data)$/.test(response.url())) {
    const headers = response.headers();
    assetResponses.push({ url: response.url(), status: response.status(),
      encoding: headers["content-encoding"], type: headers["content-type"], ray: headers["cf-ray"] });
  }
});

async function launch() {
  const start = performance.now();
  await page.locator('[data-web-play-action="start"]').click();
  await page.getByText("运行中", { exact: true }).waitFor({ timeout: 90_000 });
  const durationMs = performance.now() - start;
  const resources = await page.evaluate(() => {
    const frame = document.querySelector("#web-player-host iframe");
    return frame.contentWindow.performance.getEntriesByType("resource")
      .filter(resource => /\/easyrpg-player\.(wasm|data)$/.test(resource.name))
      .map(resource => ({ url: resource.name, durationMs: resource.duration,
        transferBytes: resource.transferSize, encodedBytes: resource.encodedBodySize,
        decodedBytes: resource.decodedBodySize, protocol: resource.nextHopProtocol }));
  });
  const completedResources = resources.filter(resource => {
    const extension = /\.(wasm|data)$/.exec(resource.url)?.[1];
    return resource.decodedBytes === assetSizes[extension];
  });
  for (const extension of ["wasm", "data"])
    assert.equal(completedResources.filter(resource => resource.url.endsWith(`.${extension}`)).length, 1,
      `One complete ${extension} download supplies both Workers`);
  assert.ok(resources.length <= 4, "At most one bounded alternate probe per asset");
  return { durationMs, resources, completedResources };
}

async function stop() {
  const summary = page.locator("summary").filter({ hasText: "本地数据与诊断" });
  if (!await summary.evaluate(element => element.parentElement.open)) await summary.click();
  await page.getByRole("button", { name: "停止游戏", exact: true }).click();
  await page.locator('[data-web-play-action="start"]').waitFor();
}

try {
  await page.goto(report.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator('[data-web-play-action="install"]').waitFor();
  const start = performance.now();
  await page.locator('[data-web-play-action="install"]').click();
  await page.locator('[data-web-play-status="ready"]').waitFor({ timeout: 90_000 });
  report.installMs = performance.now() - start;
  report.cold = await launch();
  await page.locator("#web-player-host").screenshot({ path: `${reportPath}.png` });
  await stop();
  report.warm = await launch();
  await stop();
  assert.deepEqual(errors, [], "Hydration and player startup have no uncaught errors");
  assert.ok([...report.cold.completedResources, ...report.warm.completedResources].every(resource =>
    assetResponses.some(response => response.url === resource.url && response.status === 200)), "Selected runtime responses succeed");
  assert.equal(report.warm.resources.length, 2, "Warm startup uses the remembered successful routes");
  assert.ok(report.warm.resources.every(resource => resource.transferBytes === 0), "Warm startup reuses immutable assets");
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  await page.screenshot({ path: `${reportPath}.failure.png`, fullPage: true }).catch(() => {});
} finally {
  Object.assign(report, { errors, assetResponses, browser: browser.version() });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
