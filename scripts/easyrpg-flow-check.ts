import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright";

type RuntimeWindow = Window & {
  __testModule?: { captureScreenshot(): Promise<{ blob: Blob; width: number; height: number }> };
  __testInstances: number;
};

// These bindings live in the actual dedicated Worker, inspected through Playwright.
declare const engine: {
  FS: { readFile(path: string): Uint8Array; syncFSRequests: number };
  present: (...args: number[]) => void;
  testFrames: number;
  paused: boolean;
  stopping: boolean;
  stopped: boolean;
};

/** Optional real-game regression, using the pinned official TestGame-EasyRPG fixture. */
export async function verifyEasyRpgGame(
  page: Page,
  origin: string,
  workId: number,
  archiveId: number,
) {
  const artifacts = "output/easyrpg";
  mkdirSync(artifacts, { recursive: true });
  const run = {
    runtime: JSON.parse(readFileSync("lib/archive/easyrpg-runtime.json", "utf8")).version,
    testedAt: new Date().toISOString(),
    browser: page.context().browser()?.version(),
    workId,
    archiveId,
  };
  writeFileSync(join(artifacts, "regression.json"), JSON.stringify({ ...run, passed: false }, null, 2));
  const logs: string[] = [];
  const log = (message: import("playwright").ConsoleMessage) =>
    logs.push(`${message.text()}${message.type() === "error" ? ` (${message.location().url})` : ""}`);
  page.on("console", log);
  const workers = new Map<Frame, Worker>();
  // Observe the public host API; all engine inspection targets its real Worker.
  await page.context().addInitScript({
    content: `
    window.__testInstances = 0;
    let factory;
    Object.defineProperty(window, 'createEasyRpgPlayer', { configurable: true, get: () => factory, set: value => {
      factory = async options => {
        // Run after the iframe has navigated; init scripts can see about:blank.
        if (window.parent.location.search.includes('test-hold-audio')) {
          AudioWorklet.prototype.addModule = () => {
            window.__testAudioModulePending = true;
            return new Promise(() => {});
          };
        }
        const module = await value(options);
        window.__testModule = module;
        window.parent.__testInstances++;
        return module;
      };
    }});
  `,
  });
  const playUrl = `${origin}/play/${archiveId}`;
  const savePath = `/work-saves/${workId}/Save01.lsd`;
  const key = async (frame: Frame, value: string) => {
    await frame.locator("#canvas").focus();
    // Hold for two actual engine frames, below the menu's repeat threshold.
    await page.keyboard.down(value);
    await workers.get(frame)!.evaluate(async () => {
      const target = engine.testFrames + 2;
      const deadline = performance.now() + 2000;
      while (engine.testFrames < target && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 5));
    });
    await page.keyboard.up(value);
    await page.waitForTimeout(250);
  };
  const start = async () => {
    const workerReady = page.waitForEvent("worker", worker => worker.url().endsWith("/player-worker.js"));
    await page.locator('[data-web-play-action="start"]').click();
    await page.waitForFunction(
      () => {
        const frame = document.querySelector<HTMLIFrameElement>(
          "#web-player-host iframe",
        );
        return Boolean(
          (frame?.contentWindow as RuntimeWindow | null)?.__testModule,
        );
      },
      undefined,
      { timeout: 45_000 },
    );
    const frame = page
      .frames()
      .find((item) => item.url().includes("/play/player"));
    assert.ok(frame);
    const worker = await workerReady;
    workers.set(frame, worker);
    await worker.evaluate(() => {
      const present = engine.present;
      engine.testFrames = 0;
      engine.present = (...args) => { present(...args); engine.testFrames++; };
    });
    return frame;
  };
  const saveBytes = (frame: Frame) => workers.get(frame)!.evaluate(
    path => Array.from(engine.FS.readFile(path)), savePath,
  );
  const waitForSave = (frame: Frame) => workers.get(frame)!.evaluate(async path => {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      try { if (engine.FS.readFile(path).length > 100) return; } catch { /* Not saved yet. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`No save created: ${path}`);
  }, savePath);
  const leavePlayer = async () => {
    const title = await page.getByRole("heading", { level: 1 }).innerText();
    const closed = Promise.all(page.workers()
      .filter(worker => /\/player-(?:audio-)?worker\.js$/.test(worker.url()))
      .map(worker => worker.waitForEvent("close")));
    const documentData = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/games/${workId}.data`,
    );
    await page.locator(`a[href="/games/${workId}"]`).first().click();
    assert.equal((await documentData).status(), 200, "application page data remains available");
    await page.waitForURL(`${origin}/games/${workId}`);
    const heading = page.getByRole("heading", { level: 1 });
    await heading.waitFor();
    assert.equal(await heading.innerText(), title, "detail and play pages show the same work title");
    await closed;
  };

  try {
    await page.goto(playUrl);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const first = await start();
    await page.waitForTimeout(4000); // official fixture's startup/language scene
    await key(first, "Enter");
    await page.waitForTimeout(2000);
    await key(first, "Escape");
    await page.screenshot({ path: join(artifacts, "menu.png"), fullPage: true });
    for (let index = 0; index < 3; index++) await key(first, "ArrowDown");
    await page.screenshot({ path: join(artifacts, "menu-save.png"), fullPage: true });
    await key(first, "Enter");
    await key(first, "Enter");
    await waitForSave(first);
    const saved = await saveBytes(first);
    await key(first, "F4");
    await page.getByRole("button", { name: "恢复窗口", exact: true }).waitFor();
    await key(first, "F4");
    await page.getByRole("button", { name: "恢复窗口", exact: true }).waitFor({ state: "hidden" });
    assert.ok(
      logs.some((line) => line.includes("Saving to Save01.lsd")),
      "actual in-game Save action",
    );
    // Wait for the game's own IDBFS persistence, without calling syncfs from the test.
    await first.waitForFunction(
      async ({ path, size, work }) => {
        return new Promise<boolean>((resolve) => {
          const open = indexedDB.open(`/work-saves/${work}`);
          open.onerror = () => resolve(false);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("FILE_DATA", "readonly");
            const get = tx.objectStore("FILE_DATA").get(path);
            get.onsuccess = () =>
              resolve(get.result?.contents?.length === size);
            get.onerror = () => resolve(false);
            tx.oncomplete = () => db.close();
          };
        });
      },
      { path: savePath, size: saved.length, work: workId },
    );
    await page.screenshot({
      path: join(artifacts, "saved-game.png"),
      fullPage: true,
    });

    const workerClosed = workers.get(first)!.waitForEvent("close");
    await Promise.all([leavePlayer(), workerClosed]).catch(async error => {
      console.error("Exit state", await workers.get(first)!.evaluate(() => ({
        frames: engine.testFrames, paused: engine.paused, stopping: engine.stopping,
        stopped: engine.stopped, syncRequests: engine.FS.syncFSRequests,
      })).catch(() => "worker closed"));
      throw error;
    });
    await page.locator("#web-player-host").waitFor({ state: "detached" });
    assert.ok(first.isDetached(), "player document is destroyed on SPA exit");
    await page.goBack();
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const second = await start();
    await waitForSave(second);
    assert.deepEqual(
      await saveBytes(second),
      saved,
      "save survives leaving and returning",
    );
    assert.equal(
      page.frames().filter((frame) => frame.url().includes("/play/player"))
        .length,
      1,
    );

    // Preserve the runtime's official load-game-id option to exercise a real saved-game load.
    await leavePlayer();
    await page.goto(`${playUrl}?load-game-id=1&debug`);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const restored = await start();
    await workers.get(restored)!.evaluate(async () => {
      const deadline = performance.now() + 10_000;
      while (engine.testFrames < 120 && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      if (engine.testFrames < 120) throw new Error("Engine frames stopped");
    });
    assert.deepEqual(
      await saveBytes(restored),
      saved,
      "save bytes survive document reload",
    );
    assert.ok(
      logs.some((line) => /Loading Save .*Save01\.lsd/.test(line)),
      "EasyRPG actually loads the saved game",
    );
    await page.waitForTimeout(2000); // allow the restored scene's fade-in to finish
    await page.screenshot({
      path: join(artifacts, "restored-game.png"),
      fullPage: true,
    });

    await leavePlayer();
    {
      const file = "easyrpg-player.wasm";
      await page.goto(playUrl);
      await page.locator('[data-web-play-status="ready"]').waitFor();
      let releaseStartup!: () => void;
      const startupHold = new Promise<void>((resolve) => { releaseStartup = resolve; });
      const startupRoute = `**/play/runtime/easyrpg/*/${file}`;
      await page.context().route(startupRoute, async (route) => {
        await startupHold;
        await route.abort().catch(() => undefined);
      });
      const requested = page.context().waitForEvent("request", request => request.url().endsWith(`/${file}`));
      await page.locator('[data-web-play-action="start"]').click();
      await requested;
      await leavePlayer();
      await page.locator("#web-player-host").waitFor({ state: "detached" });
      releaseStartup();
      await page.context().unroute(startupRoute);
      assert.equal(page.frames().length, 1, `${file} startup cancellation removes the iframe`);
    }

    // AudioWorklet fetches are not exposed by Playwright's request routing.
    // Hold its real startup promise instead, only in this test document.
    await page.goto(`${playUrl}?test-hold-audio`);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    await page.locator('[data-web-play-action="start"]').click();
    await page.waitForFunction(() => Boolean(
      (document.querySelector<HTMLIFrameElement>("#web-player-host iframe")?.contentWindow as
        Window & { __testAudioModulePending?: boolean })?.__testAudioModulePending,
    ));
    await leavePlayer();
    assert.equal(page.frames().length, 1, "audio startup cancellation removes the iframe");

    await page.goto(playUrl);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    await page.locator("summary").filter({ hasText: "本地数据与诊断" }).click();
    await page.getByRole("button", { name: "卸载游戏", exact: true }).click();
    const uninstall = page.getByRole("alertdialog", { name: "卸载游戏？" });
    await uninstall.getByRole("button", { name: "卸载游戏", exact: true }).click();
    await uninstall.waitFor({ state: "hidden" });
    await page.locator('[data-web-play-action="install"]').waitFor();
    let releaseDownload!: () => void;
    const downloadHold = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const downloadRoute = `**/api/archive-versions/${archiveId}/download*`;
    await page.context().route(downloadRoute, async (route) => {
      await downloadHold;
      await route.abort().catch(() => undefined);
    });
    const [installer] = await Promise.all([
      page.waitForEvent("worker"),
      page.locator('[data-web-play-action="install"]').click(),
    ]);
    await page.locator('[data-web-play-status="installing"]').waitFor();
    await page.locator(`a[href="/games/${workId}"]`).first().click();
    const confirmation = page.getByRole("alertdialog");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(
      page.url(),
      playUrl,
      "canceling leave keeps the installation page",
    );
    const installerClosed = installer.waitForEvent("close");
    const leaving = leavePlayer();
    await confirmation.getByRole("button", { name: "继续", exact: true }).click();
    await leaving;
    await installerClosed;
    releaseDownload();
    await page.context().unroute(downloadRoute);
    await page.goBack();
    // Interrupted storage buckets can already have been cleaned on re-entry.
    await page.locator('[data-web-play-action="install"]').waitFor();
    await page.locator('[data-web-play-action="install"]').click();
    await page
      .locator('[data-web-play-status="ready"]')
      .waitFor({ timeout: 45_000 });
    await page.goto(`${playUrl}?load-game-id=1&debug`);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const afterInstall = await start();
    await waitForSave(afterInstall);
    assert.deepEqual(
      await saveBytes(afterInstall),
      saved,
      "interrupted install and reinstallation preserve saves",
    );
    writeFileSync(
      join(artifacts, "regression.json"),
      JSON.stringify(
        {
          ...run,
          passed: true,
          saveBytes: saved.length,
          saveSha256: createHash("sha256")
            .update(new Uint8Array(saved))
            .digest("hex"),
          checks: [
            "game save",
            "IDBFS persistence",
            "SPA exit",
            "game and audio Workers close on exit",
            "Back/reenter",
            "document reload and load-game-id",
            "F4 page fullscreen enter/exit",
            "WASM and AudioWorklet startup exit",
            "install leave/cancel",
            "uninstall and install through current UI",
            "reinstall with save preserved",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    page.off("console", log);
    writeFileSync(join(artifacts, "runtime.log"), logs.join("\n") + "\n");
  }
}
