import type { WebPlayMetadata } from "./web-play-types";

type PlayerWindow = Window & {
  createEasyRpgPlayer?: (options: Record<string, unknown>) => Promise<{
    initApi?: () => void;
  }>;
};

export type PlayerSession = {
  ready: Promise<void>;
  dispose: () => void;
};

/** EasyRPG owns document-wide input, audio and timers. Destroy that document on exit. */
export function createPlayerSession(
  host: HTMLElement,
  metadata: WebPlayMetadata,
): PlayerSession {
  const lifetime = new AbortController();
  const frame = document.createElement("iframe");
  frame.title = `${metadata.title} 游戏画面`;
  frame.className = "h-full w-full border-0";
  frame.allow = "autoplay; fullscreen";

  function dispose() {
    lifetime.abort();
    frame.remove();
  }

  const ready = (async () => {
    await load(frame, lifetime.signal, () => {
      // Preserve the runtime's existing URL options (e.g. load-game-id).
      frame.src = `/play/player.html${window.location.search}`;
      host.appendChild(frame);
    });
    const playerWindow = frame.contentWindow as PlayerWindow | null;
    const playerDocument = frame.contentDocument;
    if (!playerWindow || !playerDocument?.getElementById("canvas"))
      throw new Error("无法创建游戏画面，请刷新后重试。");

    const script = playerDocument.createElement("script");
    await load(script, lifetime.signal, () => {
      script.src = `${metadata.runtimeBasePath}/index.js`;
      playerDocument.head.appendChild(script);
    });
    if (!playerWindow.createEasyRpgPlayer)
      throw new Error("游戏运行组件未正确加载，请刷新页面后重试。");

    const module = await untilAborted(
      playerWindow.createEasyRpgPlayer({
        game: metadata.playKey,
        workId: metadata.workId,
        locateFile: (path: string) => `${metadata.runtimeBasePath}/${path}`,
      }),
      lifetime.signal,
    );
    module.initApi?.();
  })().catch((error: unknown) => {
    dispose();
    throw error;
  });
  return { ready, dispose };
}

function load(
  element: HTMLElement,
  signal: AbortSignal,
  start: () => void,
): Promise<void> {
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
