import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { downloadZipBuilderVersion } from "../lib/archive/download";
import { hashSessionToken } from "../lib/server/auth/session";
// @ts-expect-error The shared command helper is intentionally a plain Node module.
import { runWrangler } from "./run-wrangler.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "viprpg-system-test-"));
const persistRoot = join(tempDir, "state");
const persistV3 = join(persistRoot, "v3");
const configPath = join(tempDir, "wrangler.json");
const seedPath = join(tempDir, "seed.sql");
const workerEntryPath = join(tempDir, "system-worker.mjs");
const systemTestDistDir = `.next-system-test/${basename(tempDir)}`;
const systemTestDistPath = resolve(projectRoot, systemTestDistDir);
const systemTsconfigPath = resolve(projectRoot, `${systemTestDistDir}.tsconfig.json`);
const nextCli = resolve(projectRoot, "node_modules/next/dist/bin/next");
const wranglerCli = resolve(
  projectRoot,
  "node_modules/wrangler/wrangler-dist/cli.js",
);
const testMode = process.argv[2] ?? "contract";
assert.ok(
  testMode === "contract" || testMode === "flow",
  "usage: tsx scripts/system-self-check.ts [contract|flow]",
);
const password = "system-test-password";
const passwordHash =
  "pbkdf2-sha256$870000$QdLo-2n6vY0f1uWwq2pMPA$cPaEgk4RXUTq6frnxAChkq2nKgT5fqDo_9-gKuDijI8";
const adminSessionToken = Buffer.alloc(32, 2).toString("base64url");
const coverBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sourceFiles = {
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

const watchdogSeconds = testMode === "contract" ? 90 : 180;
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
  throw new Error(`${message}\nSystem-test artifacts: ${tempDir}`, { cause: error });
} finally {
  clearTimeout(watchdog);
  await closeBrowser(browser);
  await Promise.all([stopProcess(app), stopProcess(worker)]);
  rmSync(systemTsconfigPath, { force: true });
  rmSync(systemTestDistPath, { recursive: true, force: true });
  if (passed) rmSync(tempDir, { recursive: true, force: true });
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
  await expectStatus("anonymous admin boundary", origin, "/api/admin/summary", {}, 401);
  await expectStatus(
    "missing Origin boundary",
    origin,
    "/api/imports",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
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

  stage("recover a real browser upload");
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addCookies([
    {
      name: "viprpg_session",
      value: sessionToken(userCookie),
      url: origin,
    },
  ]);
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(60_000);
  await page.goto(`${origin}/upload`, { waitUntil: "networkidle" });
  const zipInput = page.locator('input[type="file"][accept=".zip,application/zip"]');
  await zipInput.setInputFiles({
    name: "system-archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(sourceZip),
  });
  await page.locator('[data-upload-phase="awaiting_metadata"]').waitFor({ timeout: 45_000 });
  const importJobId = await waitForUploadDraft(page);
  await page.reload();
  await page.locator('[data-upload-action="resume-draft"]').click();
  await page.locator('[data-upload-phase="awaiting_metadata"]').waitFor();
  await page.locator("#upload-original-title").fill("System Archive");
  await page.locator('input[type="file"][accept="image/*"][required]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(coverBytes),
  });
  const [commitResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/imports/${importJobId}/commit`,
      { timeout: 45_000 },
    ),
    page.locator('[data-upload-phase] form button[type="submit"]').click(),
  ]);
  if (commitResponse.status() !== 200) {
    throw new Error(`archive commit: ${commitResponse.status()} ${await commitResponse.text()}`);
  }
  const commitPayload = (await commitResponse.json()) as {
    result: { workId: number; archiveVersionId: number; fileCount: number };
  };
  const { workId, archiveVersionId } = commitPayload.result;
  assert.ok(workId > 0 && archiveVersionId > 0);
  assert.equal(commitPayload.result.fileCount, 2);
  await waitForNoUploadDrafts(page);

  stage("exercise archive deletion and restore");
  await expectStatus(
    "move archive to trash",
    origin,
    `/api/admin/archive-versions/${archiveVersionId}/delete`,
    { method: "POST", headers: { accept: "application/json", cookie: userCookie, origin } },
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
    { method: "POST", headers: { accept: "application/json", cookie: adminCookie, origin } },
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
    throw new Error(`scheduled GC: ${gcResponse.status} ${await gcResponse.text()}`);
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
    throw new Error(`native download: ${download.status} ${await download.text()}`);
  }
  assert.equal(download.headers.get("x-archive-version-id"), String(archiveVersionId));
  assert.equal(download.headers.get("x-download-zip-builder"), downloadZipBuilderVersion);
  const nativeZip = new Uint8Array(await download.arrayBuffer());
  const extracted = unzipSync(nativeZip);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(sourceFiles).sort());
  for (const [path, bytes] of Object.entries(sourceFiles)) {
    assert.deepEqual(extracted[path], bytes, `downloaded bytes for ${path}`);
  }
  await stopProcess(worker);
  worker = null;

  stage("install the native archive into Chromium OPFS and reload it");
  app = startApp(appPort, origin, "app-2.log");
  await waitForHttp(`${origin}/api/health`, app);
  await context.route(
    `**/api/archive-versions/${archiveVersionId}/download**`,
    (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-length": String(nativeZip.byteLength),
          "x-download-zip-builder": downloadZipBuilderVersion,
        },
        body: Buffer.from(nativeZip),
      }),
  );
  await page.goto(`${origin}/play/${archiveVersionId}`);
  await page.locator('[data-web-play-action="install"]').click();
  await page.locator('[data-web-play-status="ready"]').waitFor({ timeout: 45_000 });
  const opfs = await inspectOpfs(page, webPlay.playKey);
  assert.deepEqual(opfs.rootEntries, ["index.json", "pack-index.json", "packs"]);
  assert.ok(opfs.packEntries.length > 0, "OPFS contains at least one pack");
  await page.reload();
  await page.locator('[data-web-play-status="ready"]').waitFor();
}

function writeTestFiles(origin: string): void {
  const workerImport = modulePath(relative(tempDir, resolve(projectRoot, "worker/archive-download.mjs")));
  const gcImport = modulePath(relative(tempDir, resolve(projectRoot, "worker/archive-gc.mjs")));
  const migrationsDir = modulePath(relative(tempDir, resolve(projectRoot, "migrations")));
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  mkdirSync(resolve(projectRoot, ".next-system-test"), { recursive: true });
  writeFileSync(
    systemTsconfigPath,
    `${JSON.stringify(
      { extends: "../tsconfig.json", exclude: ["../node_modules", "../.next", "."] },
      null,
      2,
    )}\n`,
    "utf8",
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
`;
}

function startApp(port: number, origin: string, logName: string): ManagedProcess {
  return startProcess(
    "Next dev server",
    [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    join(tempDir, logName),
    {
      APP_ORIGIN: origin,
      AUTH_SECRET: "system-self-check-secret",
      CI: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      SYSTEM_TEST_PERSIST_PATH: persistV3,
      SYSTEM_TEST_WRANGLER_CONFIG: configPath,
      SYSTEM_TEST_DIST_DIR: systemTestDistDir,
      WRANGLER_SEND_METRICS: "false",
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
  const cookie = response.headers.get("set-cookie")?.match(/viprpg_session=[A-Za-z0-9_-]{43}/)?.[0];
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
  const response = await fetch(new URL(path, origin), { redirect: "manual", ...init });
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
  assert.ok(Number.isSafeInteger(id) && id > 0, "upload recovery draft has an import id");
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

async function waitForHttp(url: string, process: ManagedProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(`${process.label} exited early:\n${logTail(process.logPath)}`);
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
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.kill();
  if (await Promise.race([closed.then(() => true), delay(3_000).then(() => false)])) return;
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

function sessionToken(cookie: string): string {
  const token = cookie.split("=", 2)[1];
  assert.ok(token);
  return token;
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
