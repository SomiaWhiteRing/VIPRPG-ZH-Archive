import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { deploymentOrigins } from "./deployment-config.mjs";

const { values } = parseArgs({ options: {
  env: { type: "string", default: "staging" },
  "work-id": { type: "string", default: "1" },
  report: { type: "string", default: "output/easyrpg/cold-start.json" },
} });
assert.ok(Object.hasOwn(deploymentOrigins, values.env), "Unknown environment");
const workId = Number(values["work-id"]);
assert.ok(Number.isSafeInteger(workId) && workId > 0, "Invalid work ID");
const reportPath = resolve(values.report);
mkdirSync(dirname(reportPath), { recursive: true });
const errors = [], assetResponses = [];
const report = { passed: false, url: `${deploymentOrigins[values.env]}/play/${workId}` };
const browser = await chromium.launch({
  headless: true,
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
  assert.equal(resources.length, 2, "Each engine asset is requested once");
  return { durationMs, resources };
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
  assert.ok(assetResponses.every(response => response.status === 200), "Runtime responses succeed");
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
