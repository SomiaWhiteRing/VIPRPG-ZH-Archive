import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page } from "playwright";

type RuntimeWindow = Window & {
  __testModule?: {
    FS: { readFile(path: string): Uint8Array; syncFSRequests: number };
  };
  __testFrames: number;
  __testInstances: number;
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
  const logs: string[] = [];
  const log = (message: import("playwright").ConsoleMessage) =>
    logs.push(`${message.text()}${message.type() === "error" ? ` (${message.location().url})` : ""}`);
  page.on("console", log);
  // Observation only: retain the module within its own document and count executed frames.
  await page.context().addInitScript({
    content: `
    window.__testFrames = 0;
    window.__testInstances = 0;
    let factory;
    Object.defineProperty(window, 'createEasyRpgPlayer', { configurable: true, get: () => factory, set: value => {
      factory = async options => {
        const module = await value(options);
        window.__testModule = module;
        window.parent.__testInstances++;
        return module;
      };
    }});
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const runtime = new Error().stack?.includes('/play/runtime/');
      return raf(time => { if (runtime) window.parent.__testFrames++; callback(time); });
    };
  `,
  });
  const playUrl = `${origin}/play/${archiveId}`;
  const savePath = `/work-saves/${workId}/Save01.lsd`;
  const key = async (frame: Frame, value: string) => {
    await frame.locator("#canvas").focus();
    // EasyRPG polls input per frame; a zero-duration synthetic key can disappear between frames.
    await page.keyboard.press(value, { delay: 120 });
    await page.waitForTimeout(250);
  };
  const start = async () => {
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
    return frame;
  };
  const saveBytes = (frame: Frame) =>
    frame.evaluate(
      (path) =>
        Array.from((window as unknown as RuntimeWindow).__testModule!.FS.readFile(path)),
      savePath,
    );
  const leavePlayer = async () => {
    const documentData = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/games/${workId}.data`,
    );
    await page.locator(`a[href="/games/${workId}"]`).first().click();
    assert.equal((await documentData).status(), 200, "SW must not intercept application page data");
    await page.waitForURL(`${origin}/games/${workId}`);
    await page.getByRole("heading", { name: "System Archive", exact: true }).waitFor();
  };

  try {
    await page.goto(playUrl);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const first = await start();
    await page.waitForTimeout(4000); // official fixture's startup/language scene
    await key(first, "Enter");
    await page.waitForTimeout(1500);
    await key(first, "Escape");
    for (let index = 0; index < 3; index++) await key(first, "ArrowDown");
    await key(first, "Enter");
    await key(first, "Enter");
    await first.waitForFunction((path) => {
      try {
        return (
          (window as unknown as RuntimeWindow).__testModule!.FS.readFile(path).length > 100
        );
      } catch {
        return false;
      }
    }, savePath);
    const saved = await saveBytes(first);
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

    await leavePlayer();
    await page.locator("#web-player-host").waitFor({ state: "detached" });
    assert.ok(first.isDetached(), "player document is destroyed on SPA exit");
    const stopped = await page.evaluate(
      () => (window as unknown as RuntimeWindow).__testFrames,
    );
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => (window as unknown as RuntimeWindow).__testFrames),
      stopped,
      "old runtime stops executing after exit",
    );
    await page.goBack();
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const second = await start();
    await second.waitForFunction((path) => {
      try {
        return (
          (window as unknown as RuntimeWindow).__testModule!.FS.readFile(path).length > 100
        );
      } catch {
        return false;
      }
    }, savePath);
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
    await page.goto(`${playUrl}?load-game-id=1&debug`);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const restored = await start();
    await page.waitForFunction(
      () => (window as unknown as RuntimeWindow).__testFrames > 120,
    );
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

    await page.goto(playUrl);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    let releaseStartup!: () => void;
    const startupHold = new Promise<void>((resolve) => {
      releaseStartup = resolve;
    });
    const wasmRoute = "**/play/runtime/easyrpg/*/index.wasm";
    await page.route(wasmRoute, async (route) => {
      await startupHold;
      await route.abort().catch(() => undefined);
    });
    const wasmRequested = page.waitForRequest((request) =>
      request.url().endsWith("/index.wasm"),
    );
    await page.locator('[data-web-play-action="start"]').click();
    await wasmRequested;
    await leavePlayer();
    await page.locator("#web-player-host").waitFor({ state: "detached" });
    releaseStartup();
    await page.unroute(wasmRoute);
    assert.equal(
      page.frames().length,
      1,
      "in-flight startup cannot leave an iframe behind",
    );

    await page.goto(playUrl);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    await page.locator("summary").filter({ hasText: "本地数据与诊断" }).click();
    let releaseDownload!: () => void;
    const downloadHold = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const downloadRoute = `**/api/archive-versions/${archiveId}/download*`;
    await page.context().route(downloadRoute, async (route) => {
      await downloadHold;
      await route.abort().catch(() => undefined);
    });
    const workerReady = page.waitForEvent("worker");
    await page.getByRole("button", { name: "重新安装", exact: true }).click();
    const installer = await workerReady;
    await page.locator('[data-web-play-status="installing"]').waitFor();
    let leave = false;
    const confirm = (dialog: import("playwright").Dialog) =>
      void (leave ? dialog.accept() : dialog.dismiss());
    page.on("dialog", confirm);
    await Promise.all([
      page.waitForEvent("dialog"),
      page.locator(`a[href="/games/${workId}"]`).first().click(),
    ]);
    assert.equal(
      page.url(),
      playUrl,
      "canceling leave keeps the installation page",
    );
    leave = true;
    const installerClosed = installer.waitForEvent("close");
    await leavePlayer();
    await installerClosed;
    page.off("dialog", confirm);
    releaseDownload();
    await page.context().unroute(downloadRoute);
    await page.goBack();
    await page.locator('[data-web-play-status="installing"]').waitFor();
    await page.locator('[data-web-play-action="install"]').click();
    await page
      .locator('[data-web-play-status="ready"]')
      .waitFor({ timeout: 45_000 });
    await page.goto(`${playUrl}?load-game-id=1&debug`);
    await page.locator('[data-web-play-status="ready"]').waitFor();
    const afterInstall = await start();
    await afterInstall.waitForFunction((path) => {
      try {
        return (
          (window as unknown as RuntimeWindow).__testModule!.FS.readFile(path).length > 100
        );
      } catch {
        return false;
      }
    }, savePath);
    assert.deepEqual(
      await saveBytes(afterInstall),
      saved,
      "interrupted install and reinstallation preserve saves",
    );
    writeFileSync(
      join(artifacts, "regression.json"),
      JSON.stringify(
        {
          passed: true,
          workId,
          archiveId,
          saveBytes: saved.length,
          saveSha256: createHash("sha256")
            .update(new Uint8Array(saved))
            .digest("hex"),
          checks: [
            "game save",
            "IDBFS persistence",
            "SPA exit",
            "Back/reenter",
            "document reload and load-game-id",
            "startup exit",
            "install leave/cancel",
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
