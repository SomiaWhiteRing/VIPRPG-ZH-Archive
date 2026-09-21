import { unzipSync, zipSync } from "fflate";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { hashSessionToken } from "../app/.server/auth/session";
import { downloadZipBuilderVersion } from "../lib/archive/download";
import { easyRpgRuntimeBasePath } from "../lib/archive/web-play";
import { runWrangler } from "./run-wrangler.mjs";
import { verifyEasyRpgGame } from "./easyrpg-flow-check";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "viprpg-system-test-"));
const persistRoot = join(tempDir, "state");
const configPath = join(tempDir, "wrangler.json");
const nativeConfigPath = join(tempDir, "native-wrangler.json");
const seedPath = join(tempDir, "seed.sql");
const workerEntryPath = join(tempDir, "system-worker.mjs");
const wranglerCli = resolve(
  projectRoot,
  "node_modules/wrangler/wrangler-dist/cli.js",
);
const testMode = process.argv[2] ?? "contract";
const gameIndex = process.argv.indexOf("--game");
const gamePath = gameIndex >= 0 ? process.argv[gameIndex + 1] : undefined;
if (gameIndex >= 0)
  assert.ok(
    testMode === "flow" && gamePath,
    "--game requires flow and a ZIP path",
  );
assert.ok(
  testMode === "contract" || testMode === "flow",
  "usage: tsx scripts/system-self-check.ts [contract|flow]",
);
const password = "system-test-password";
const passwordHash =
  "scrypt$32768$8$3$QdLo-2n6vY0f1uWwq2pMPA$-di8_t7Ig7hpcVrgFaRS6mPtEWOqt-fyxi5HV5A0Qm4";
const adminSessionToken = Buffer.alloc(32, 2).toString("base64url");
const coverBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sourceFiles = gamePath
  ? unzipSync(readFileSync(gamePath))
  : {
      "RPG_RT.lmt": new TextEncoder().encode("system-test-map-tree"),
      "Picture/system-test.png": coverBytes,
    };
const sourceZip = zipSync(sourceFiles, { level: 0 });
const catalogWorkIds = [101, 102] as const;
const managedChildren = new Set<ChildProcess>();

type CatalogMutation = {
  catalog: {
    items: Array<{
      workId: number;
      sortOrder: number;
      note: string | null;
    }>;
  };
};

let app: ManagedProcess | null = null;
let worker: ManagedProcess | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let passed = false;
const browserErrors: string[] = [];

const watchdogSeconds = testMode === "contract" ? 90 : gamePath ? 360 : 180;
const watchdog = setTimeout(() => {
  console.error(
    `[system:${testMode}] exceeded ${watchdogSeconds} seconds; artifacts preserved at ${tempDir}`,
  );
  void emergencyStop().finally(() => process.exit(1));
}, watchdogSeconds * 1_000);

try {
  await run();
  passed = true;
  console.log(`${testMode} self-check passed`);
} catch (error) {
  await captureFailure(page);
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}\nSystem-test artifacts: ${tempDir}`, {
    cause: error,
  });
} finally {
  clearTimeout(watchdog);
  await closeBrowser(browser);
  await Promise.all([stopProcess(app), stopProcess(worker)]);
  // Windows can release SQLite and log handles shortly after process-tree termination.
  if (passed)
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
}

async function run(): Promise<void> {
  const appPort = await freePort();
  const workerPort = await freePort();
  const origin = `http://127.0.0.1:${appPort}`;
  writeTestFiles(origin);

  stage("migrate and seed isolated D1/R2 state");
  await runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persistRoot,
  ]);
  const adminSessionHash = await hashSessionToken(adminSessionToken);
  writeFileSync(seedPath, seedSql(passwordHash, adminSessionHash), "utf8");
  await runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persistRoot,
    "--file",
    seedPath,
  ]);

  stage("exercise stable HTTP and catalog contracts");
  app = startApp(appPort, origin, "app-1.log");
  await waitForHttp(`${origin}/api/health`, app);
  await expectStatus(
    "anonymous admin boundary",
    origin,
    "/api/admin/summary",
    {},
    401,
  );
  await expectStatus(
    "missing Origin boundary",
    origin,
    "/api/imports",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    403,
  );

  const adminCookie = `viprpg_session=${adminSessionToken}`;
  await expectStatus(
    "admin dashboard",
    origin,
    "/api/admin/summary",
    { headers: { cookie: adminCookie } },
    200,
  );
  const [lowerWorkId, higherWorkId] = catalogWorkIds;
  const catalog = await jsonResponse<{ catalog: { id: number } }>(
    "create catalog",
    origin,
    "/api/catalogs",
    jsonMutation(origin, adminCookie, {
      title: "Contract catalog",
      description: "Stable catalog invariants",
    }),
    201,
  );
  await jsonResponse<CatalogMutation>(
    "add first catalog item",
    origin,
    `/api/catalogs/${catalog.catalog.id}/items`,
    jsonMutation(origin, adminCookie, {
      workId: lowerWorkId,
      note: "lower",
    }),
    200,
  );
  const defaultCatalogOrder = await jsonResponse<CatalogMutation>(
    "add second catalog item",
    origin,
    `/api/catalogs/${catalog.catalog.id}/items`,
    jsonMutation(origin, adminCookie, { workId: higherWorkId, note: "higher" }),
    200,
  );
  assert.deepEqual(
    defaultCatalogOrder.catalog.items.map((item) => item.workId),
    [higherWorkId, lowerWorkId],
  );
  assert.deepEqual(
    defaultCatalogOrder.catalog.items.map((item) => item.sortOrder),
    [0, 0],
  );
  const updatedCatalogOrder = await jsonResponse<CatalogMutation>(
    "update one catalog item sort value",
    origin,
    `/api/catalogs/${catalog.catalog.id}/items`,
    {
      ...jsonMutation(origin, adminCookie, {
        workId: higherWorkId,
        sortOrder: 1,
        note: "updated",
      }),
      method: "PATCH",
    },
    200,
  );
  assert.deepEqual(
    updatedCatalogOrder.catalog.items.map((item) => [
      item.workId,
      item.sortOrder,
    ]),
    [
      [lowerWorkId, 0],
      [higherWorkId, 1],
    ],
  );
  assert.equal(
    updatedCatalogOrder.catalog.items.find(
      (item) => item.workId === higherWorkId,
    )?.note,
    "updated",
  );
  for (const sortOrder of [-1, 0.5]) {
    await expectStatus(
      `reject catalog sort value ${sortOrder}`,
      origin,
      `/api/catalogs/${catalog.catalog.id}/items`,
      {
        ...jsonMutation(origin, adminCookie, {
          workId: higherWorkId,
          sortOrder,
          note: "invalid",
        }),
        method: "PATCH",
      },
      400,
    );
  }
  await verifyPageContracts(origin, adminCookie);
  if (testMode === "contract") return;

  stage("prepare uploader permission for the preproduction flow");
  const userCookie = await login(origin, "user@example.test");
  await expectStatus(
    "ordinary user cannot upload",
    origin,
    "/api/imports",
    jsonMutation(origin, userCookie, {}),
    403,
  );
  const access = await jsonResponse<{ inboxItem: { id: number } }>(
    "request uploader access",
    origin,
    "/api/account/request-upload-access",
    {
      method: "POST",
      headers: { accept: "application/json", cookie: userCookie, origin },
    },
    200,
  );
  await expectStatus(
    "approve uploader access",
    origin,
    `/api/inbox/${access.inboxItem.id}/resolve`,
    formMutation(origin, adminCookie, { decision: "approve" }, true),
    200,
  );

  browser = await chromium.launch({ headless: true });
  await verifyEditorNavigation(browser, origin, adminCookie);
  await verifyPermissionHistory(browser, origin);
  stage("recover a real browser upload");
  context = await browser.newContext();
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(60_000);
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill("user@example.test");
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form[action="/api/auth/login"] button[type="submit"]')
    .click();
  await page.waitForURL(origin + "/");
  const browserSession = (await context.cookies()).find(
    (cookie) => cookie.name === "viprpg_session",
  );
  assert.ok(browserSession?.httpOnly && browserSession.sameSite === "Lax");
  await verifyForumNavigation(page, origin);
  await page.goto(`${origin}/upload`, { waitUntil: "networkidle" });
  const zipInput = page.locator(
    'input[type="file"][accept=".zip,application/zip"]',
  );
  await zipInput.setInputFiles({
    name: "system-archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(sourceZip),
  });
  await page
    .locator('[data-upload-phase="awaiting_metadata"]')
    .waitFor({ timeout: 45_000 });
  const importJobId = await waitForUploadDraft(page);
  const competingTab = await context.newPage();
  await competingTab.goto(`${origin}/upload`, { waitUntil: "networkidle" });
  await competingTab.locator('[data-upload-action="resume-draft"]').click();
  await competingTab
    .getByText("这个上传草稿正在另一个标签页中处理。", { exact: true })
    .waitFor();
  assert.equal(
    await competingTab
      .locator('[data-upload-phase="awaiting_metadata"]')
      .count(),
    0,
    "another tab cannot take over an active upload",
  );
  await competingTab.close();
  await page.reload();
  await page.locator('[data-upload-action="resume-draft"]').click();
  await page.locator('[data-upload-phase="awaiting_metadata"]').waitFor();
  await page.locator("#upload-original-title").fill("System Archive");
  await page.locator("#upload-release-date").click();
  await page
    .getByText(String(new Date().getFullYear()), { exact: true })
    .click();
  await page.locator("#upload-release-date").press("Escape");
  await page
    .locator('input[type="file"][accept="image/*"][required]')
    .setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: Buffer.from(coverBytes),
    });
  await page.getByRole("button", { name: "选择封面", exact: true }).click();
  await page.getByRole("button", { name: "使用此封面", exact: true }).click();
  await page
    .getByRole("dialog", { name: "设置封面" })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("[data-upload-phase] form")
      .evaluate((form) => (form as HTMLFormElement).checkValidity()),
    true,
    "complete upload metadata fixture",
  );
  const [commitResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/imports/${importJobId}/commit`,
      { timeout: 45_000 },
    ),
    page.locator('[data-upload-phase] form button[type="submit"]').click(),
  ]);
  if (commitResponse.status() !== 200) {
    throw new Error(
      `archive commit: ${commitResponse.status()} ${await commitResponse.text()}`,
    );
  }
  const commitPayload = (await commitResponse.json()) as {
    result: { workId: number; archiveVersionId: number; fileCount: number };
  };
  const { workId, archiveVersionId } = commitPayload.result;
  assert.ok(workId > 0 && archiveVersionId > 0);
  assert.equal(commitPayload.result.fileCount, Object.keys(sourceFiles).length);
  await waitForNoUploadDrafts(page);

  stage("verify cancel-on-leave releases the upload draft");
  await page.goto(`${origin}/upload`);
  await page
    .locator('input[type="file"][accept=".zip,application/zip"]')
    .setInputFiles({
      name: "cancel-archive.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(sourceZip),
    });
  await page.locator('[data-upload-phase="awaiting_metadata"]').waitFor();
  const canceledJob = await waitForUploadDraft(page);
  const uploadLeave = page.getByRole("alertdialog");
  await page.locator('a[href="/games"]').first().click();
  await uploadLeave.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(new URL(page.url()).pathname, "/upload");
  await page.locator('a[href="/games"]').first().click();
  await uploadLeave.getByRole("button", { name: "取消上传并离开", exact: true }).click();
  await page.waitForURL(origin + "/games");
  const canceled = await jsonResponse<{ importJob: { status: string } }>(
    "canceled upload",
    origin,
    `/api/imports/${canceledJob}`,
    { headers: { cookie: userCookie } },
    200,
  );
  assert.equal(canceled.importJob.status, "canceled");
  await waitForNoUploadDrafts(page);

  stage("exercise archive deletion and restore");
  await expectStatus(
    "move archive to trash",
    origin,
    `/api/admin/archive-versions/${archiveVersionId}/delete`,
    {
      method: "POST",
      headers: { accept: "application/json", cookie: userCookie, origin },
    },
    200,
  );
  await expectStatus(
    "deleted archive is not playable",
    origin,
    `/api/archive-versions/${archiveVersionId}/web-play`,
    {},
    404,
  );
  await expectStatus(
    "restore archive",
    origin,
    `/api/admin/archive-versions/${archiveVersionId}/restore`,
    {
      method: "POST",
      headers: { accept: "application/json", cookie: adminCookie, origin },
    },
    200,
  );
  const webPlay = await jsonResponse<{ playKey: string }>(
    "restored archive is playable",
    origin,
    `/api/archive-versions/${archiveVersionId}/web-play`,
    {},
    200,
  );

  stage("run native GC and download worker against the same isolated state");
  await stopProcess(app);
  app = null;
  worker = startWorker(workerPort);
  const workerOrigin = `http://127.0.0.1:${workerPort}`;
  await waitForHttp(`${workerOrigin}/__system/health`, worker);
  const gcResponse = await fetch(`${workerOrigin}/__system/gc`);
  if (gcResponse.status !== 200) {
    throw new Error(
      `scheduled GC: ${gcResponse.status} ${await gcResponse.text()}`,
    );
  }
  const gc = (await gcResponse.json()) as {
    archiveVersions: { failedCount: number };
    blobs: { failedCount: number };
    corePacks: { failedCount: number };
  };
  assert.equal(gc.archiveVersions.failedCount, 0);
  assert.equal(gc.blobs.failedCount, 0);
  assert.equal(gc.corePacks.failedCount, 0);
  const download = await fetch(
    `${workerOrigin}/api/archive-versions/${archiveVersionId}/download?zip_builder=${encodeURIComponent(downloadZipBuilderVersion)}`,
  );
  if (download.status !== 200) {
    throw new Error(
      `native download: ${download.status} ${await download.text()}`,
    );
  }
  assert.equal(
    download.headers.get("x-archive-version-id"),
    String(archiveVersionId),
  );
  assert.equal(
    download.headers.get("x-download-zip-builder"),
    downloadZipBuilderVersion,
  );
  const nativeZip = new Uint8Array(await download.arrayBuffer());
  const extracted = unzipSync(nativeZip);
  assert.deepEqual(
    Object.keys(extracted).sort(),
    Object.keys(sourceFiles).sort(),
  );
  for (const [path, bytes] of Object.entries(sourceFiles)) {
    assert.deepEqual(extracted[path], bytes, `downloaded bytes for ${path}`);
  }
  await stopProcess(worker);
  worker = null;

  stage("install the native archive into Chromium OPFS and reload it");
  app = startApp(appPort, origin, "app-2.log");
  await waitForHttp(`${origin}/api/health`, app);
  await page.goto(`${origin}/games/${workId}`);
  await page.locator(`a[href="/play/${archiveVersionId}"]`).first().click();
  await page.waitForURL(`${origin}/play/${archiveVersionId}`);
  await page.locator('[data-web-play-action="install"]').click();
  await page
    .locator('[data-web-play-status="ready"]')
    .waitFor({ timeout: 45_000 });
  const opfs = await inspectOpfs(page, webPlay.playKey);
  assert.deepEqual(opfs.rootEntries, [
    "index.json",
    "pack-index.json",
    "packs",
  ]);
  assert.ok(opfs.packEntries.length > 0, "OPFS contains at least one pack");
  const virtualFiles = await page.evaluate(
    async ({ playKey, workId, runtimeBasePath }) => {
      const prefix = `${runtimeBasePath}/games/${playKey}`;
      const valid = await fetch(prefix + "/RPG_RT.lmt");
      const other = await fetch(
        prefix.replace(playKey, playKey + "-other") + "/RPG_RT.lmt",
      );
      const wasm = await fetch(`${runtimeBasePath}/index.wasm`);
      const wasmMime = wasm.headers.get("content-type");
      await WebAssembly.compileStreaming(wasm);
      const pageData = await fetch(`/games/${workId}.data`);
      return {
        pageData: pageData.status,
        valid: valid.status,
        body: await valid.text(),
        other: other.status,
        wasmMime,
        scope: (await navigator.serviceWorker.getRegistration())?.scope,
      };
    },
    { playKey: webPlay.playKey, workId, runtimeBasePath: easyRpgRuntimeBasePath },
  );
  assert.equal(virtualFiles.valid, 200);
  assert.equal(virtualFiles.pageData, 200, "play SW must leave Router page data to the server");
  assert.equal(
    virtualFiles.body,
    new TextDecoder().decode(sourceFiles["RPG_RT.lmt"]),
  );
  assert.equal(
    virtualFiles.other,
    404,
    "uninstalled playKey cannot read a different version's files",
  );
  assert.match(virtualFiles.wasmMime ?? "", /application\/wasm/);
  assert.equal(virtualFiles.scope, origin + "/play/");
  await page.reload();
  await page.locator('[data-web-play-status="ready"]').waitFor();
  // Exercise the action button as well as the tab, from a document outside /play/.
  await page.goto(`${origin}/games/${workId}`);
  await page.locator(`a[href="/play/${archiveVersionId}"]`).last().click();
  await page.waitForURL(`${origin}/play/${archiveVersionId}`);
  await page.locator('[data-web-play-status="ready"]').waitFor();
  assert.equal(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    origin + "/play/sw.js",
    "both play entry points must load a document controlled by the play worker",
  );
  assert.deepEqual(
    browserErrors,
    [],
    "hydration and browser Workers have no uncaught errors",
  );
  if (gamePath) {
    stage(
      "run the official EasyRPG game, save/load, and verify player/installer lifetimes",
    );
    await verifyEasyRpgGame(page, origin, workId, archiveVersionId);
    assert.deepEqual(
      browserErrors,
      [],
      "real-game flow has no uncaught browser errors",
    );
  }
}

async function verifyEditorNavigation(
  currentBrowser: Browser,
  origin: string,
  adminCookie: string,
) {
  stage("verify editor state follows the entity through browser history");
  const editorContext = await currentBrowser.newContext();
  const editor = await editorContext.newPage();
  try {
    await editorContext.addCookies([
      { name: "viprpg_session", value: adminCookie.split("=")[1], url: origin },
    ]);
    editor.on("pageerror", (error) => browserErrors.push(error.message));
    editor.setDefaultTimeout(10_000);
    const cases = [
      {
        paths: ["/admin/archive-versions/201", "/admin/archive-versions/202"],
        field: 'input[name="source_name"]',
        values: ["Editor Archive A", "Editor Archive B"],
        targets: [201, 202].map(
          (id) => `form[action="/api/admin/archive-versions/${id}/update"]`,
        ),
      },
      {
        paths: catalogWorkIds.map((id) => `/me/uploads/${id}`),
        field: "#upload-original-title",
        values: ["Contract Work A", "Contract Work B"],
        targets: catalogWorkIds.map(
          (id) => `form[action="/api/works/${id}/delete"]`,
        ),
      },
    ];
    for (const { paths, field, values, targets } of cases) {
      await editor.goto(origin + paths[0]);
      await editor.locator(field).waitFor();
      assert.equal(await editor.locator(field).inputValue(), values[0]);
      // Add a same-document history entry, then traverse it with native Back/Forward.
      // No router globals or test-only product routes are needed.
      await editor.evaluate((path) => {
        history.pushState(
          { ...history.state, idx: history.state.idx + 1 },
          "",
          path,
        );
      }, paths[1]);
      await editor.goBack();
      await editor.waitForURL(origin + paths[0]);
      await editor.locator(field).fill("Unsaved value from A");
      const originalDocument = await editor.locator("body").elementHandle();
      await editor.goForward();
      await editor.waitForURL(origin + paths[1]);
      await editor.locator(targets[1]).waitFor({ state: "attached" });
      assert.equal(
        await originalDocument!.evaluate((body) => body === document.body),
        true,
        "history traversal must keep the document alive",
      );
      assert.equal(
        await editor.locator(field).inputValue(),
        values[1],
        `${paths[1]} loaded its submission target but retained another entity's field value`,
      );
      if (paths[1].startsWith("/admin/archive-versions/")) {
        assert.equal(
          await editor.locator('input[name="archive_version_id"]').inputValue(),
          "202",
        );
        const form = editor.locator(
          'form:has(input[name="archive_version_id"])',
        );
        assert.equal(
          await form.getAttribute("action"),
          "/api/admin/archive-versions/202/update",
        );
        const submitted = await form.evaluate((element) =>
          Object.fromEntries(new FormData(element as HTMLFormElement)),
        );
        assert.equal(submitted.status, "hidden");
        assert.equal(submitted.source_url, "https://example.test/editor-b");
      }
      await editor.locator(field).fill("Unsaved value from B");
      await editor.goBack();
      await editor.waitForURL(origin + paths[0]);
      await editor.locator(targets[0]).waitFor({ state: "attached" });
      assert.equal(
        await editor.locator(field).inputValue(),
        values[0],
        `${paths[0]} must restore its own data on Back navigation`,
      );
    }
    await verifyCatalogEditorNavigation(editor, origin, adminCookie);
    await verifyWorkDialogs(editor, origin, adminCookie);
  } catch (error) {
    await captureFailure(editor);
    throw error;
  } finally {
    await editorContext.close();
  }
}

async function verifyWorkDialogs(
  editor: Page,
  origin: string,
  adminCookie: string,
) {
  stage("verify hydrated game views and work dialog identity");
  await editor.goto(origin + "/games", { waitUntil: "networkidle" });
  await editor.locator('a[href="/games/101"]').first().waitFor();
  for (const view of ["网格视图", "列表视图"]) {
    await editor.getByRole("link", { name: view, exact: true }).click();
    await editor.waitForLoadState("networkidle");
    assert.ok(await editor.locator('a[href="/games/101"]').count());
  }
  await expectStatus(
    "related navigation fixture",
    origin,
    "/api/works/101/relations",
    jsonMutation(origin, adminCookie, {
      targetWorkId: 102,
      relationType: "same_setting",
    }),
    201,
  );
  const catalog = await jsonResponse<{ catalog: { id: number } }>(
    "dialog catalog",
    origin,
    "/api/catalogs",
    jsonMutation(origin, adminCookie, { title: "Dialog destination" }),
    201,
  );
  await editor.goto(origin + "/games/101", { waitUntil: "networkidle" });
  await editor.locator('a[href="/games/102"]').first().click();
  await editor.waitForURL(origin + "/games/102");
  await editor.getByRole("button", { name: "添加到目录", exact: true }).click();
  await editor.getByRole("combobox", { name: "目录", exact: true }).click();
  await editor
    .getByRole("option", { name: "Dialog destination", exact: true })
    .click();
  // A successful addition closes the dialog; reopening it must still follow work identity.
  const saved = editor.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/catalogs/${catalog.catalog.id}/items`) &&
      r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "添加", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await editor.waitForLoadState("networkidle");
  await editor.getByRole("dialog").waitFor({ state: "detached" });
  await editor.getByRole("button", { name: "添加到目录", exact: true }).click();
  await editor.getByRole("dialog").waitFor();
  await editor.goBack();
  await editor.waitForURL(origin + "/games/101");
  await editor.getByRole("dialog").waitFor({ state: "detached" });

  await editor.goto(origin + "/games/102/relations", {
    waitUntil: "networkidle",
  });
  for (const path of ["/games/102", "/games/101", "/games/101/relations"]) {
    await editor.locator(`a[href="${path}"]`).first().click();
    await editor.waitForURL(origin + path);
  }
  await editor
    .getByRole("combobox", { name: "关联作品", exact: true })
    .fill("Relation target C");
  await editor.getByRole("option", { name: "Relation target C", exact: true }).click();
  await editor.evaluate(() => history.go(-3));
  await editor.waitForURL(origin + "/games/102/relations");
  await editor.locator('input[id="relation-target-102"]').waitFor();
  assert.equal(
    await editor.getByRole("combobox", { name: "关联作品", exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await editor
      .getByRole("button", { name: "添加关联", exact: true })
      .isDisabled(),
    true,
  );
}

async function verifyPermissionHistory(
  currentBrowser: Browser,
  origin: string,
) {
  stage("protect permission drafts without the Navigation API");
  const rootCookie = await login(origin, "root@example.test");
  const rootContext = await currentBrowser.newContext();
  try {
    await rootContext.addCookies([
      { name: "viprpg_session", value: rootCookie.split("=")[1], url: origin },
    ]);
    await rootContext.addInitScript(() =>
      Object.defineProperty(window, "navigation", {
        value: undefined,
        configurable: true,
      }),
    );
    const matrix = await rootContext.newPage();
    await matrix.goto(origin + "/admin", { waitUntil: "networkidle" });
    await matrix.locator('a[href="/admin/permissions"]').first().click();
    await matrix.waitForURL(origin + "/admin/permissions");
    await matrix
      .locator("summary")
      .filter({ hasText: "新建自定义角色" })
      .click();
    const field = matrix.locator('details input[name="name"]');
    await field.fill("Unsaved role");
    const confirmation = matrix.getByRole("alertdialog");
    await matrix.goBack();
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await matrix.waitForURL(origin + "/admin/permissions");
    assert.equal(await field.inputValue(), "Unsaved role");
    await matrix.goBack();
    await confirmation.getByRole("button", { name: "继续", exact: true }).click();
    await matrix.waitForURL(origin + "/admin");
  } finally {
    await rootContext.close();
  }
}

async function verifyCatalogEditorNavigation(
  editor: Page,
  origin: string,
  adminCookie: string,
) {
  stage("prevent catalog drafts from being submitted to another catalog");
  const catalogs: Array<{ id: number; title: string }> = [];
  for (const title of ["Editor catalog A", "Editor catalog B"]) {
    const result = await jsonResponse<{
      catalog: { id: number; title: string };
    }>(
      "create editor catalog",
      origin,
      "/api/catalogs",
      jsonMutation(origin, adminCookie, { title }),
      201,
    );
    catalogs.push(result.catalog);
  }
  const [a, b] = catalogs;
  await editor.goto(`${origin}/catalogs/${b.id}`);
  await editor.locator(`a[href="/catalogs/${a.id}"]`).click();
  await editor.waitForURL(`${origin}/catalogs/${a.id}`);
  await editor.getByRole("button", { name: "编辑资料", exact: true }).click();
  await editor.locator("#catalog-title").fill("Unsaved catalog A");
  await editor.goBack();
  await editor.waitForURL(`${origin}/catalogs/${b.id}`);
  await editor.getByRole("dialog").waitFor({ state: "detached" });
  await editor.getByRole("button", { name: "编辑资料", exact: true }).click();
  assert.equal(await editor.locator("#catalog-title").inputValue(), b.title);
  await editor.locator("#catalog-title").fill("Updated catalog B");
  const [saved] = await Promise.all([
    editor.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/catalogs/${b.id}`,
    ),
    editor.getByRole("button", { name: "保存资料", exact: true }).click(),
  ]);
  assert.equal(saved.status(), 200);
  const result = (await saved.json()) as {
    catalog: { id: number; title: string };
  };
  assert.equal(result.catalog.id, b.id);
  assert.equal(result.catalog.title, "Updated catalog B");
  await editor.getByRole("dialog").waitFor({ state: "detached" });
  await editor.goForward();
  await editor.waitForURL(`${origin}/catalogs/${a.id}`);
  await editor.getByRole("heading", { name: a.title, exact: true }).waitFor();
  await editor.getByRole("button", { name: "编辑资料", exact: true }).click();
  assert.equal(await editor.locator("#catalog-title").inputValue(), a.title);
}

async function verifyForumNavigation(currentPage: Page, origin: string) {
  stage(
    "verify client navigation, forum publishing and persisted drafts",
  );
  await currentPage.goto(`${origin}/games/${catalogWorkIds[0]}`);
  await currentPage.evaluate(() => {
    (window as Window & { migrationDocument?: string }).migrationDocument =
      "same-document";
  });
  await currentPage.locator('a[href="/discussions"]').first().click();
  await currentPage.waitForURL(origin + "/discussions");
  assert.equal(
    await currentPage.evaluate(
      () =>
        (window as Window & { migrationDocument?: string }).migrationDocument,
    ),
    "same-document",
  );
  await currentPage
    .getByRole("button", { name: "发布主题", exact: true })
    .click();
  await currentPage.locator("#forum-title").fill("SSR migration discussion");
  await currentPage
    .locator('[data-forum-editor] [contenteditable="true"]')
    .fill("Published through the browser");
  const jpeg = await currentPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await currentPage
    .locator('[data-forum-editor] input[type="file"]')
    .setInputFiles({
      name: "forum.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(jpeg, "base64"),
    });
  await currentPage.locator("[data-forum-editor] img").first().waitFor();
  await currentPage
    .locator("[data-forum-editor]")
    .getByRole("button", { name: "发布主题", exact: true })
    .click();
  await currentPage.waitForURL(/\/discussions\/\d+(?:[#?].*)?$/);
  const topicUrl = currentPage.url();
  await currentPage
    .getByRole("button", { name: "更多操作", exact: true })
    .first()
    .click();
  await currentPage
    .getByRole("menuitem", { name: "编辑主题", exact: true })
    .click();
  await currentPage.locator("#forum-title").fill("Edited migration discussion");
  await currentPage
    .locator("[data-forum-editor]")
    .getByRole("button", { name: "保存修改", exact: true })
    .click();
  await currentPage
    .getByRole("heading", { name: "Edited migration discussion", exact: true })
    .waitFor();
  const raw = await fetch(topicUrl);
  assert.ok((await raw.text()).includes("Edited migration discussion"));
  await currentPage
    .getByRole("button", { name: "回复主题……", exact: true })
    .click();
  await currentPage
    .locator('[data-forum-editor] [contenteditable="true"]')
    .fill("Draft must survive navigation");
  await currentPage.locator('a[href="/games"]').first().click();
  await currentPage.waitForURL(origin + "/games");
  await currentPage.goBack();
  await currentPage.waitForURL(topicUrl);
  await currentPage.getByRole("button", { name: "Draft must survive navigation", exact: true }).click();
  assert.ok(
    (
      await currentPage
        .locator('[data-forum-editor] [contenteditable="true"]')
        .textContent()
    )?.includes("Draft must survive"),
  );
  await currentPage.goForward();
  await currentPage.waitForURL(origin + "/games");
}

async function verifyPageContracts(origin: string, adminCookie: string) {
  stage("verify SSR, routing and request isolation");
  const document = await fetch(`${origin}/games/${catalogWorkIds[0]}`);
  assert.equal(document.status, 200);
  assert.equal(document.headers.get("cache-control"), "private, no-store");
  const html = await document.text();
  const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.ok(
    visibleHtml.includes("Contract Work A"),
    "public content is present before hydration",
  );
  assert.match(html, /<title>[^<]+<\/title>/);
  for (const path of [
    "/missing-page",
    "/games/99999999",
    "/assets/missing.js",
    "/play/runtime/missing.wasm",
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, path);
    if (path.startsWith("/assets/") || path.startsWith("/play/runtime/")) {
      assert.ok(
        !(await response.text()).includes("__reactRouter"),
        "missing assets cannot fall through to SSR",
      );
    }
  }
  const missingApi = await fetch(`${origin}/api/not-a-route`);
  assert.equal(missingApi.status, 404);
  assert.match(
    missingApi.headers.get("content-type") ?? "",
    /application\/json/,
  );
  const method = await fetch(`${origin}/api/health`, { method: "POST" });
  assert.equal(method.status, 405);
  const head = await fetch(`${origin}/games/${catalogWorkIds[0]}`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const memberCookie = await login(origin, "user@example.test");
  for (const path of ["/me", "/me/discussions"]) {
    await expectStatus(
      "own discussion history",
      origin,
      path,
      { headers: { cookie: memberCookie } },
      200,
    );
  }
  for (const path of [
    "/admin/users",
    "/admin/users.data?_routes=admin/users/page",
    "/me/profile.data?_routes=me/profile/page",
  ]) {
    const anonymous = await fetch(origin + path, { redirect: "manual" });
    const dataRequest = path.includes(".data");
    if (dataRequest) {
      const data = await anonymous.text();
      assert.ok(
        anonymous.status >= 300 || data.includes("/login"),
        "data loaders independently enforce login",
      );
      assert.ok(!data.includes("root@example.test"));
    } else {
      assert.equal(anonymous.status, 307);
      assert.match(anonymous.headers.get("location") ?? "", /^\/login/);
    }
  }
  const denied = await fetch(
    `${origin}/admin/users.data?_routes=admin/users/page`,
    { headers: { cookie: memberCookie }, redirect: "manual" },
  );
  const deniedBody = await denied.text();
  assert.ok(
    denied.status >= 300 ||
      (deniedBody.includes("redirect") && deniedBody.includes('"/"')),
    "child loader preserves the permission-denied redirect",
  );
  assert.ok(!deniedBody.includes("root@example.test"));
  // Serial requests through one live isolate expose accidental module-level user caching.
  for (const [cookie, expected, absent] of [
    [adminCookie, "Admin", "user@example.test"],
    [memberCookie, "User", "admin@example.test"],
    [adminCookie, "Admin", "user@example.test"],
  ]) {
    const response = await fetch(`${origin}/me/profile`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const content = await response.text();
    assert.ok(content.includes(expected));
    assert.ok(
      !content.includes(absent),
      "identity cannot leak across requests",
    );
    assert.ok(
      !content.includes("scrypt$") &&
        !content.includes("sessionHash") &&
        !content.includes("passwordHash"),
      "private auth fields cannot enter hydration data",
    );
  }
  const sw = await fetch(`${origin}/play/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("cache-control") ?? "", /no-store/);
  const player = await fetch(`${origin}/play/player.html`);
  assert.equal(player.status, 200);
  assert.match(player.headers.get("content-type") ?? "", /text\/html/);
  assert.match(player.headers.get("cache-control") ?? "", /no-store/);
  assert.ok(!(await player.text()).includes("__reactRouter"));
}

function writeTestFiles(origin: string): void {
  const workerImport = modulePath(
    relative(tempDir, resolve(projectRoot, "worker/archive-download.mjs")),
  );
  const gcImport = modulePath(
    relative(tempDir, resolve(projectRoot, "worker/archive-gc.mjs")),
  );
  const migrationsDir = modulePath(
    relative(tempDir, resolve(projectRoot, "migrations")),
  );
  writeFileSync(
    workerEntryPath,
    `import { maybeHandleArchiveDownload } from ${JSON.stringify(workerImport)};
import { runScheduledArchiveGc } from ${JSON.stringify(gcImport)};

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === "/__system/health") return Response.json({ ok: true });
    if (path === "/__system/gc") {
      return Response.json(await runScheduledArchiveGc(env, {
        trigger: "system-self-check",
        graceDays: 0,
        limitPerType: 20,
      }));
    }
    return (await maybeHandleArchiveDownload(request, env, ctx)) ?? new Response("Not found", { status: 404 });
  },
};
`,
    "utf8",
  );
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        name: "viprpg-system-test",
        main: "system-worker.mjs",
        compatibility_date: "2026-04-30",
        compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
        d1_databases: [
          {
            binding: "DB",
            database_name: "viprpg-system-test",
            database_id: "00000000-0000-0000-0000-000000000001",
            migrations_dir: migrationsDir,
          },
        ],
        r2_buckets: [
          { binding: "ARCHIVE_BUCKET", bucket_name: "viprpg-system-test" },
        ],
        vars: {
          APP_ORIGIN: origin,
          EMAIL_FROM: "system@example.test",
        },
        ratelimits: [
          {
            name: "AUTH_EMAIL_RATE_LIMITER",
            namespace_id: "1",
            simple: { limit: 5, period: 60 },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const nativeConfig = JSON.parse(readFileSync(configPath, "utf8"));
  writeFileSync(nativeConfigPath, JSON.stringify(nativeConfig));
  const serverEntry = resolve(projectRoot, "build/server/index.js");
  assert.ok(
    existsSync(serverEntry),
    "Run npm run build before the system checks",
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      ...nativeConfig,
      main: serverEntry,
      assets: {
        directory: resolve(projectRoot, "build/client"),
        binding: "ASSETS",
        html_handling: "none",
        not_found_handling: "none",
      },
      vars: { ...nativeConfig.vars, AUTH_SECRET: "system-self-check-secret" },
    }),
  );
}

function seedSql(passwordHash: string, adminSessionHash: string): string {
  return `
INSERT INTO users (id, external_auth_id, email, password_hash, display_name, email_verified_at)
VALUES
  (1, 'email:root@example.test', 'root@example.test', '${sqlQuote(passwordHash)}', 'Root', CURRENT_TIMESTAMP),
  (2, 'email:admin@example.test', 'admin@example.test', '${sqlQuote(passwordHash)}', 'Admin', CURRENT_TIMESTAMP),
  (3, 'email:user@example.test', 'user@example.test', '${sqlQuote(passwordHash)}', 'User', CURRENT_TIMESTAMP);
INSERT INTO user_roles (user_id, role_id)
SELECT 1, id FROM roles WHERE key='super_admin';
INSERT INTO user_roles (user_id, role_id)
SELECT 2, id FROM roles WHERE key='admin';
INSERT INTO user_sessions (user_id, session_hash, expires_at)
VALUES (2, '${sqlQuote(adminSessionHash)}', datetime('now', '+1 day'));
INSERT INTO works (id, original_title, status, created_by_user_id, published_at)
VALUES
  (${catalogWorkIds[0]}, 'Contract Work A', 'published', 2, CURRENT_TIMESTAMP),
  (${catalogWorkIds[1]}, 'Contract Work B', 'published', 2, CURRENT_TIMESTAMP);
UPDATE works SET engine_family='rpg_maker_mv' WHERE id IN (${catalogWorkIds.join(",")});
INSERT INTO work_external_links (work_id, label, url, link_type)
VALUES (${catalogWorkIds[0]}, 'Download', 'https://example.test/a', 'download_page'),
       (${catalogWorkIds[1]}, 'Download', 'https://example.test/b', 'download_page');
INSERT INTO work_uploaders (work_id, user_id)
VALUES (${catalogWorkIds[0]}, 2), (${catalogWorkIds[1]}, 2);
${
  testMode === "flow"
    ? `
INSERT INTO works (id, original_title, status, created_by_user_id, published_at)
VALUES (103, 'Relation target C', 'published', 2, CURRENT_TIMESTAMP);
UPDATE works SET engine_family='rpg_maker_mv' WHERE id=103;
INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(103,'Download','https://example.test/c','download_page');
INSERT INTO works (id, original_title, status, created_by_user_id)
VALUES (201, 'Editor Archive Work A', 'hidden', 2),
       (202, 'Editor Archive Work B', 'hidden', 2);
INSERT INTO archive_versions (id, work_id, source_name, source_url,
  manifest_sha256, file_policy_version, packer_version, source_type, status)
VALUES (201, 201, 'Editor Archive A', 'https://example.test/editor-a',
  '${"a".repeat(64)}', '1', '1', 'browser_zip', 'published'),
       (202, 202, 'Editor Archive B', 'https://example.test/editor-b',
  '${"b".repeat(64)}', '1', '1', 'browser_zip', 'hidden');
`
    : ""
}
`;
}

function startApp(
  port: number,
  _origin: string,
  logName: string,
): ManagedProcess {
  return startProcess(
    "production Worker",
    [
      wranglerCli,
      "dev",
      "--config",
      configPath,
      "--local",
      "--persist-to",
      persistRoot,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    join(tempDir, logName),
    {
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
  );
}

function startWorker(port: number): ManagedProcess {
  return startProcess(
    "native Worker",
    [
      wranglerCli,
      "dev",
      "--config",
      nativeConfigPath,
      "--local",
      "--persist-to",
      persistRoot,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    join(tempDir, "worker.log"),
    { CI: "true", WRANGLER_SEND_METRICS: "false" },
  );
}

async function login(origin: string, email: string): Promise<string> {
  const response = await fetch(new URL("/api/auth/login", origin), {
    ...formMutation(origin, null, { email, password, next: "/" }),
    redirect: "manual",
  });
  assert.equal(response.status, 303, `login status for ${email}`);
  const cookie = response.headers
    .get("set-cookie")
    ?.match(/viprpg_session=[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(cookie, `opaque session cookie for ${email}`);
  return cookie;
}

async function expectStatus(
  label: string,
  origin: string,
  path: string,
  init: RequestInit,
  expected: number,
): Promise<Response> {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    ...init,
  });
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected ${expected}, received ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

async function jsonResponse<T>(
  label: string,
  origin: string,
  path: string,
  init: RequestInit,
  expected: number,
): Promise<T> {
  const response = await expectStatus(label, origin, path, init, expected);
  return (await response.json()) as T;
}

function jsonMutation(
  origin: string,
  cookie: string,
  body: unknown,
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify(body),
  };
}

function formMutation(
  origin: string,
  cookie: string | null,
  values: Record<string, string>,
  acceptJson = false,
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    origin,
  };
  if (cookie) headers.cookie = cookie;
  if (acceptJson) headers.accept = "application/json";
  return { method: "POST", headers, body: new URLSearchParams(values) };
}

async function waitForUploadDraft(currentPage: Page): Promise<number> {
  const handle = await currentPage.waitForFunction(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("viprpg-upload-drafts", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ serverImportJobId: number }>>(
      (resolve, reject) => {
        const request = database
          .transaction("drafts", "readonly")
          .objectStore("drafts")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    return rows[0]?.serverImportJobId ?? 0;
  });
  const id = await handle.jsonValue();
  assert.ok(
    Number.isSafeInteger(id) && id > 0,
    "upload recovery draft has an import id",
  );
  return id;
}

async function waitForNoUploadDrafts(currentPage: Page): Promise<void> {
  await currentPage.waitForFunction(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("viprpg-upload-drafts", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<boolean>((resolve, reject) => {
      const request = database
        .transaction("drafts", "readonly")
        .objectStore("drafts")
        .count();
      request.onsuccess = () => resolve(request.result === 0);
      request.onerror = () => reject(request.error);
    });
  });
}

async function inspectOpfs(currentPage: Page, playKey: string) {
  return currentPage.evaluate(async (key) => {
    let directory = await navigator.storage.getDirectory();
    for (const part of ["viprpg-archive", "games", key]) {
      directory = await directory.getDirectoryHandle(part);
    }
    const rootEntries: string[] = [];
    for await (const name of directory.keys()) rootEntries.push(name);
    const packs = await directory.getDirectoryHandle("packs");
    const packEntries: string[] = [];
    for await (const name of packs.keys()) packEntries.push(name);
    return { rootEntries: rootEntries.sort(), packEntries: packEntries.sort() };
  }, playKey);
}

type ManagedProcess = {
  child: ChildProcess;
  label: string;
  logPath: string;
};

function startProcess(
  label: string,
  args: string[],
  logPath: string,
  env: Record<string, string>,
): ManagedProcess {
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedChildren.add(child);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("close", () => {
    managedChildren.delete(child);
    log.end();
  });
  return { child, label, logPath };
}

async function waitForHttp(
  url: string,
  process: ManagedProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(
        `${process.label} exited early:\n${logTail(process.logPath)}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${process.label} did not become ready (${lastError}):\n${logTail(process.logPath)}`,
  );
}

async function stopProcess(managed: ManagedProcess | null): Promise<void> {
  const child = managed?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  if (process.platform === "win32" && child.pid) {
    // Terminate the process tree before the parent exits, so workerd releases D1/R2 files.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill();
  }
  if (
    await Promise.race([
      closed.then(() => true),
      delay(3_000).then(() => false),
    ])
  )
    return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
  await Promise.race([closed, delay(3_000)]);
}

async function emergencyStop(): Promise<void> {
  await closeBrowser(browser);
  await Promise.all(
    [...managedChildren].map((child) =>
      stopProcess({ child, label: "managed process", logPath: "" }),
    ),
  );
}

async function captureFailure(currentPage: Page | null): Promise<void> {
  await currentPage
    ?.screenshot({ path: join(tempDir, "failure.png"), fullPage: true })
    .catch(() => undefined);
}

async function closeBrowser(currentBrowser: Browser | null): Promise<void> {
  await currentBrowser?.close().catch(() => undefined);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function sqlQuote(value: string): string {
  return value.replaceAll("'", "''");
}

function modulePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function stage(message: string): void {
  console.log(`[system] ${message}`);
}

function logTail(path: string): string {
  if (!path || !existsSync(path)) return "(no process log)";
  return readFileSync(path, "utf8").slice(-6_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
