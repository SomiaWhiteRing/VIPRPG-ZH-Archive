import type { WebPlayMetadata } from "./web-play-types";
import { readGamePackages } from "./web-play-opfs";
import { acquireGameResourceReadLock } from "./web-play-locks";
import { getWebPlayInstallation } from "./web-play-db";
import playerStyles from "../player.css?inline";

type PlayerWindow = Window & {
  console: Console;
  KeyboardEvent: typeof KeyboardEvent;
  createEasyRpgPlayer?: (options: Record<string, unknown>) => Promise<{
    captureScreenshot: () => Promise<PlayerScreenshot>;
    stop: () => Promise<void>;
  }>;
};

export type PlayerLogLevel = "debug" | "info" | "warning" | "error";

type PlayerLogHandler = (level: PlayerLogLevel, message: string) => void;

const playerButtons = {
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  decision: { key: "z", code: "KeyZ", keyCode: 90 },
  cancel: { key: "x", code: "KeyX", keyCode: 88 },
  shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  menu: { key: "F1", code: "F1", keyCode: 112 },
  debug: { key: "F9", code: "F9", keyCode: 120 },
  log: { key: "`", code: "Backquote", keyCode: 192 },
  fastForward3: { key: "f", code: "KeyF", keyCode: 70 },
  fastForward10: { key: "g", code: "KeyG", keyCode: 71 },
} as const;

export type PlayerButton = keyof typeof playerButtons;

// Known FluidSynth Web and bundled SoundFont messages; retain other diagnostics.
const suppressedPlayerLogs = new Set([
  "fluidsynth: error: function fluid_stat is a stub, always returning -1",
  ...["Piano 1", "Piano 2", "Piano 3", "Honky-tonk"].map(
    (instrument) =>
      `fluidsynth: warning: Instrument '${instrument}': Some invalid generators were discarded, audible glitches are to be expected! Run fluidsynth in verbose mode for detailed information.`,
  ),
]);

export type PlayerSession = {
  ready: Promise<void>;
  captureScreenshot: () => Promise<PlayerScreenshot>;
  setButtonPressed: (button: PlayerButton, pressed: boolean) => void;
  dispose: () => Promise<void>;
};

export type PlayerScreenshot = {
  blob: Blob;
  width: number;
  height: number;
};

/** EasyRPG owns document-wide input, audio and timers. Destroy that document on exit. */
export function createPlayerSession(
  host: HTMLElement,
  metadata: WebPlayMetadata,
  onLog: PlayerLogHandler,
  onFullscreen: () => void,
  onExit: () => void,
): PlayerSession {
  const lifetime = new AbortController();
  const resourceLifetime = new AbortController();
  const heldButtons = new Set<PlayerButton>();
  let disconnectLogs: (() => void) | undefined;
  let runtime: Awaited<ReturnType<NonNullable<PlayerWindow["createEasyRpgPlayer"]>>> | undefined;
  let runtimeCreation: Promise<NonNullable<typeof runtime>> | undefined;
  let disposing: Promise<void> | undefined;
  let releaseResources: (() => void) | undefined;
  const frame = document.createElement("iframe");
  frame.title = `${metadata.title} 游戏画面`;
  frame.className = "block h-full w-full border-0";
  frame.allow = "autoplay; fullscreen";

  function setButtonPressed(button: PlayerButton, pressed: boolean) {
    if (lifetime.signal.aborted || heldButtons.has(button) === pressed) return;
    const playerWindow = frame.contentWindow as PlayerWindow | null;
    const canvas = frame.contentDocument?.querySelector("canvas");
    if (!playerWindow || !canvas) return;
    if (pressed) heldButtons.add(button);
    else heldButtons.delete(button);
    const key = playerButtons[button];
    // The host forwards this document's key events to the engine Worker.
    canvas.dispatchEvent(new playerWindow.KeyboardEvent(pressed ? "keydown" : "keyup", {
      ...key,
      which: key.keyCode,
      location: button === "shift" ? 1 : 0,
      shiftKey: heldButtons.has("shift"),
      bubbles: true,
      cancelable: true,
    }));
  }

  function dispose(): Promise<void> {
    if (disposing) return disposing;
    for (const button of heldButtons) setButtonPressed(button, false);
    lifetime.abort();
    disposing = (async () => {
      try {
        const current = runtime ?? await runtimeCreation?.catch(() => undefined);
        await current?.stop();
      } catch (error) {
        disposing = undefined;
        throw error;
      }
      disconnectLogs?.();
      disconnectLogs = undefined;
      frame.remove();
      resourceLifetime.abort();
      releaseResources?.();
      releaseResources = undefined;
    })();
    // Cleanup on unmount cannot await; retain an error report for failed saves.
    void disposing.catch(error => onLog("error", formatLogValue(error)));
    return disposing;
  }

  const ready = (async () => {
    releaseResources = await acquireGameResourceReadLock(metadata.playKey, resourceLifetime.signal);
    lifetime.signal.throwIfAborted();
    if ((await getWebPlayInstallation(metadata.playKey))?.status !== "ready") {
      throw new Error("本地游戏资源已更新或清理，请刷新页面后重新安装。");
    }
    const packages = await readGamePackages(
      metadata.playKey, metadata.archiveVersionId, metadata.manifestSha256, lifetime.signal,
    );
    await load(frame, lifetime.signal, () => {
      // Preserve the runtime's existing URL options (e.g. load-game-id).
      frame.src = `/play/player.html${window.location.search}`;
      host.appendChild(frame);
    });
    const playerWindow = frame.contentWindow as PlayerWindow | null;
    const playerDocument = frame.contentDocument;
    if (!playerWindow || !playerDocument?.getElementById("canvas"))
      throw new Error("无法创建游戏画面，请刷新后重试。");

    // The isolated document needs its own compiled Tailwind utilities.
    const styles = playerDocument.createElement("style");
    styles.textContent = playerStyles;
    playerDocument.head.appendChild(styles);

    // Keep right-button input available to the game; cancel only the browser UI.
    playerDocument.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal: lifetime.signal,
    });

    // Capture Worker diagnostics forwarded by its iframe and keep DevTools output.
    disconnectLogs = connectPlayerLogs(playerWindow, lifetime.signal, onLog);

    const script = playerDocument.createElement("script");
    await load(script, lifetime.signal, () => {
      script.src = `${metadata.runtimeBasePath}/index.js`;
      playerDocument.head.appendChild(script);
    });
    if (!playerWindow.createEasyRpgPlayer)
      throw new Error("游戏运行组件未正确加载，请刷新页面后重试。");

    const args: string[] = [];
    const loadId = new URLSearchParams(window.location.search).get("load-game-id");
    if (loadId && /^\d+$/.test(loadId)) args.push("--load-game-id", loadId);
    runtimeCreation = playerWindow.createEasyRpgPlayer({
      packages,
      workId: metadata.workId,
      runtimeBase: `${metadata.runtimeBasePath}/`,
      arguments: args,
      signal: lifetime.signal,
      onError: (error: unknown) => onLog("error", formatLogValue(error)),
      onFullscreen,
      onExit: () => { void dispose().then(onExit).catch(() => {}); },
    });
    runtime = await untilAborted(runtimeCreation, lifetime.signal);
  })().catch((error: unknown) => {
    const failure = new Error(formatLogValue(error));
    void dispose();
    throw failure;
  });
  async function captureScreenshot(): Promise<PlayerScreenshot> {
    await ready;
    lifetime.signal.throwIfAborted();
    return untilAborted(runtime!.captureScreenshot(), lifetime.signal);
  }

  return { ready, captureScreenshot, setButtonPressed, dispose };
}

function connectPlayerLogs(
  playerWindow: PlayerWindow,
  signal: AbortSignal,
  onLog: PlayerLogHandler,
): () => void {
  const methods = {
    debug: "debug",
    log: "info",
    info: "info",
    warn: "warning",
    error: "error",
  } as const;
  const restore: (() => void)[] = [];
  const forward = (level: PlayerLogLevel, values: unknown[]) => {
    if (signal.aborted) return;
    const message = values
      .map(formatLogValue)
      .join(" ")
      .split(/\r?\n/)
      .filter((line) => !suppressedPlayerLogs.has(line.trim()))
      .join("\n");
    if (message.trim()) onLog(level, message);
  };

  for (const method of Object.keys(methods) as (keyof typeof methods)[]) {
    const original = playerWindow.console[method];
    playerWindow.console[method] = (...values: unknown[]) => {
      original.apply(playerWindow.console, values);
      forward(methods[method], values);
    };
    restore.push(() => {
      playerWindow.console[method] = original;
    });
  }

  playerWindow.addEventListener(
    "error",
    (event) => forward("error", [event.error ?? event.message]),
    { signal },
  );
  playerWindow.addEventListener(
    "unhandledrejection",
    (event) => forward("error", [event.reason]),
    { signal },
  );

  return () => restore.forEach((reset) => reset());
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    // Errors originate in another window, so instanceof Error is unreliable.
    if ("stack" in value && typeof value.stack === "string") return value.stack;
    if ("message" in value && typeof value.message === "string") return value.message;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Console output may contain circular objects.
    }
  }
  return String(value);
}

function load(
  element: HTMLElement,
  signal: AbortSignal,
  start: () => void,
): Promise<void> {
  signal.throwIfAborted();
  return untilAborted(
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        element.removeEventListener("load", loaded);
        element.removeEventListener("error", failed);
        signal.removeEventListener("abort", canceled);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("游戏运行组件加载失败，请刷新页面后重试。"));
      };
      const canceled = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(failed, 15_000);
      element.addEventListener("load", loaded);
      element.addEventListener("error", failed);
      signal.addEventListener("abort", canceled, { once: true });
      start();
    }),
    signal,
  );
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
