"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteWebPlayInstallation,
  getWebPlayInstallation,
  markWebPlayLastPlayed,
} from "@/app/play/[archiveVersionId]/web-play-db";
import { deleteGameOpfsDirectory } from "@/app/play/[archiveVersionId]/web-play-opfs";
import type {
  WebPlayInstallation,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
} from "@/app/play/[archiveVersionId]/web-play-types";

type WebPlayLog = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

type EasyRpgModule = {
  initApi?: () => void;
  requestFullscreen?: () => void;
  setCanvasSize?: (width: number, height: number) => void;
};

declare global {
  interface Window {
    createEasyRpgPlayer?: (options: Record<string, unknown>) => Promise<EasyRpgModule>;
  }
}

export function WebPlayClient({ metadata }: { metadata: WebPlayMetadata }) {
  const [installation, setInstallation] = useState<WebPlayInstallation | null>(null);
  const [loadingLocalState, setLoadingLocalState] = useState(true);
  const [installSessionActive, setInstallSessionActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [playerStarting, setPlayerStarting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [logs, setLogs] = useState<WebPlayLog[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const moduleRef = useRef<EasyRpgModule | null>(null);

  const installed = installation?.status === "ready";
  const installing = installation?.status === "installing";
  const activeInstalling = installing && installSessionActive;
  const interruptedInstalling = installing && !installSessionActive;
  const failed = installation?.status === "failed";
  const playerBusy = running || playerStarting;

  const addLog = useCallback((level: WebPlayLog["level"], message: string) => {
    setLogs((current) =>
      [
        {
          id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
          level,
          message,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 80),
    );
  }, []);

  useEffect(() => {
    let mounted = true;

    getWebPlayInstallation(metadata.playKey)
      .then((value) => {
        if (mounted) {
          setInstallation(value);

          if (value?.status === "installing") {
            addLog(
              "warning",
              "检测到上次安装未完成。浏览器刷新或崩溃后，当前版本会清理并重新安装。",
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          addLog(
            "warning",
            error instanceof Error ? error.message : "读取本地安装状态失败。",
          );
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingLocalState(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [addLog, metadata.playKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        playKey?: string;
        path?: string;
        message?: string;
      };

      if (message.type !== "web-play-file-missing" || message.playKey !== metadata.playKey) {
        return;
      }

      addLog(
        "error",
        `EasyRPG 请求文件失败：${message.path ?? "unknown"}${
          message.message ? `（${message.message}）` : ""
        }`,
      );
    };

    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [addLog, metadata.playKey]);

  useEffect(() => {
    if (!activeInstalling) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [activeInstalling]);

  useEffect(() => {
    if (!running) {
      return;
    }

    const onFullscreenChange = () => {
      focusPlayerCanvas();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [running]);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL("./web-play-install-worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<WebPlayInstallWorkerOutput>) => {
      const message = event.data;

      if (message.type === "installation") {
        setInstallation(message.installation);

        if (
          message.installation.status === "ready" ||
          message.installation.status === "failed" ||
          message.installation.status === "deleted"
        ) {
          setInstallSessionActive(false);
        }

        return;
      }

      addLog(message.level, message.message);
    };
    workerRef.current = worker;

    return worker;
  }, [addLog]);

  const startInstall = useCallback(async () => {
    setOperationError(null);

    try {
      if (playerBusy) {
        throw new Error("游戏运行中不能重装本地缓存。");
      }

      setInstallSessionActive(true);
      const storageSnapshot = await requestBrowserStorage();
      await registerPlayServiceWorker();
      const worker = ensureWorker();

      worker.postMessage({
        type: "install",
        metadata,
        storageSnapshot,
      } satisfies WebPlayInstallWorkerInput);
      addLog("info", "开始下载并安装到浏览器本地。");
    } catch (error) {
      setInstallSessionActive(false);
      const message = error instanceof Error ? error.message : "启动安装失败。";
      setOperationError(message);
      addLog("error", message);
    }
  }, [addLog, ensureWorker, metadata, playerBusy]);

  const cancelInstall = useCallback(() => {
    workerRef.current?.postMessage({
      type: "cancel",
      playKey: metadata.playKey,
    } satisfies WebPlayInstallWorkerInput);
    addLog("warning", "已请求取消安装。");
  }, [addLog, metadata.playKey]);

  const deleteLocalInstall = useCallback(async () => {
    setOperationError(null);

    try {
      if (playerBusy) {
        throw new Error("游戏运行中不能删除本地缓存。");
      }

      await deleteGameOpfsDirectory(metadata.playKey);
      await deleteWebPlayInstallation(metadata.playKey);
      setInstallation(null);
      addLog("info", "已删除本地游戏缓存。EasyRPG 存档不随资源缓存删除。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除本地缓存失败。";
      setOperationError(message);
      addLog("error", message);
    }
  }, [addLog, metadata.playKey, playerBusy]);

  const startPlayer = useCallback(async () => {
    setOperationError(null);

    try {
      if (playerBusy) {
        return;
      }

      if (!installed) {
        throw new Error("需要先完成本地安装。");
      }

      setPlayerStarting(true);
      await registerPlayServiceWorker();
      await loadEasyRpgRuntime(metadata.runtimeBasePath);

      if (!window.createEasyRpgPlayer) {
        throw new Error("EasyRPG runtime 未正确加载。");
      }

      setRunning(true);
      addLog("info", "EasyRPG runtime 已加载，正在启动游戏。");
      const playerModule = await window.createEasyRpgPlayer({
        game: metadata.playKey,
        locateFile: (path: string) => `${metadata.runtimeBasePath}/${path}`,
      });

      playerModule.initApi?.();
      moduleRef.current = playerModule;
      focusPlayerCanvas();
      await markWebPlayLastPlayed(metadata.playKey);
      addLog("info", "游戏已启动。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动在线游玩失败。";
      setOperationError(message);
      addLog("error", message);
      setRunning(false);
    } finally {
      setPlayerStarting(false);
    }
  }, [addLog, installed, metadata.playKey, metadata.runtimeBasePath, playerBusy]);

  const requestFullscreen = useCallback(() => {
    if (!running) {
      addLog("warning", "游戏启动后才能进入全屏。");
      return;
    }

    const frame = document.getElementById("web-player-frame");

    if (!frame?.requestFullscreen) {
      addLog("warning", "当前浏览器不支持全屏 API。");
      return;
    }

    frame
      .requestFullscreen()
      .then(() => {
        focusPlayerCanvas();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "进入全屏失败。";

        setOperationError(message);
        addLog("error", message);
      });
  }, [addLog, running]);

  const storageSummary = useMemo(() => {
    if (!installation) {
      return null;
    }

    return [
      ["本地状态", statusLabel(installation.status)],
      ["持久化", installation.persistedStorage === null ? "未请求" : installation.persistedStorage ? "已允许" : "未允许"],
      ["浏览器用量", formatBytes(installation.storageUsageBytes ?? 0)],
      ["浏览器额度", formatBytes(installation.storageQuotaBytes ?? 0)],
    ];
  }, [installation]);

  if (!metadata.canPlay) {
    return (
      <section className="card web-play-card">
        <h2>在线游玩不可用</h2>
        <p>
          该作品标记为 Maniacs Patch。MVP 阶段不展示 EasyRPG 在线游玩入口，请使用 ZIP 下载。
        </p>
      </section>
    );
  }

  return (
    <div className="web-play-layout">
      <section className="card web-play-card">
        <div className="web-play-header">
          <div>
            <p className="eyebrow">EasyRPG Web Player</p>
            <h2>浏览器本地安装</h2>
          </div>
          <span className="status-pill">
            {loadingLocalState ? "读取中" : statusLabel(installation?.status ?? "deleted")}
          </span>
        </div>

        <dl className="upload-source-summary">
          <div>
            <dt>归档大小</dt>
            <dd>{formatBytes(metadata.totalSizeBytes)}</dd>
          </div>
          <div>
            <dt>文件数</dt>
            <dd>{metadata.totalFiles.toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>本地写入</dt>
            <dd>
              {formatBytes(metadata.installTotalSizeBytes)} /{" "}
              {metadata.installTotalFiles.toLocaleString("zh-CN")} 文件
            </dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>{metadata.releaseLabel}</dd>
          </div>
          <div>
            <dt>ArchiveVersion</dt>
            <dd>{metadata.archiveLabel}</dd>
          </div>
        </dl>

        {storageSummary ? (
          <dl className="web-play-storage">
            {storageSummary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {installation ? <InstallProgress installation={installation} /> : null}
        {interruptedInstalling ? (
          <p className="error-message compact">
            上次安装没有正常结束。请清理并重装本地缓存。
          </p>
        ) : null}
        {operationError ? <p className="error-message compact">{operationError}</p> : null}

        <div className="actions">
          {!installed && !installing ? (
            <button className="button primary" onClick={startInstall} type="button">
              安装到浏览器
            </button>
          ) : null}
          {activeInstalling ? (
            <button className="button" onClick={cancelInstall} type="button">
              取消安装
            </button>
          ) : null}
          {failed || interruptedInstalling ? (
            <button className="button primary" onClick={startInstall} type="button">
              清理并重装
            </button>
          ) : null}
          {installed ? (
            <>
              <button
                className="button primary"
                disabled={playerBusy}
                onClick={startPlayer}
                type="button"
              >
                {running ? "运行中" : playerStarting ? "启动中" : "启动游戏"}
              </button>
              <button
                className="button"
                disabled={!running}
                onClick={requestFullscreen}
                type="button"
              >
                全屏
              </button>
              <button
                className="button"
                disabled={playerBusy}
                onClick={deleteLocalInstall}
                type="button"
              >
                删除本地缓存
              </button>
              <button
                className="button"
                disabled={playerBusy}
                onClick={startInstall}
                type="button"
              >
                重新安装
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="card web-player-card">
        <div className="web-player-frame" id="web-player-frame">
          <canvas id="canvas" tabIndex={0} />
        </div>
        <div id="status" className="web-player-status">
          {running ? "EasyRPG 正在运行" : "未启动"}
        </div>
      </section>

      <section className="card web-play-log-card">
        <div className="web-play-header">
          <h2>日志</h2>
          <button className="button" onClick={() => setLogs([])} type="button">
            清空
          </button>
        </div>
        {logs.length > 0 ? (
          <ol className="web-play-log-list">
            {logs.map((log) => (
              <li className={log.level} key={log.id}>
                <span>{new Date(log.createdAt).toLocaleTimeString("zh-CN")}</span>
                <p>{log.message}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无日志。</p>
        )}
      </section>
    </div>
  );
}

function InstallProgress({ installation }: { installation: WebPlayInstallation }) {
  const downloadPercent = percent(
    installation.downloadedBytes,
    installation.downloadBytesTotal,
  );
  const extractPercent =
    installation.totalSizeBytes > 0
      ? percent(installation.installedBytes, installation.totalSizeBytes)
      : percent(installation.installedFiles, installation.totalFiles);

  return (
    <div className="web-play-progress-block">
      <div>
        <span>ZIP 下载</span>
        <strong>
          {formatBytes(installation.downloadedBytes)} /{" "}
          {formatBytes(installation.downloadBytesTotal)}
        </strong>
      </div>
      <div className="upload-progress">
        <span style={{ width: `${downloadPercent}%` }} />
      </div>
      <div>
        <span>本地写入</span>
        <strong>
          {installation.installedFiles.toLocaleString("zh-CN")} /{" "}
          {installation.totalFiles.toLocaleString("zh-CN")} 文件
        </strong>
      </div>
      <div className="upload-progress">
        <span style={{ width: `${extractPercent}%` }} />
      </div>
      {installation.currentPath ? (
        <p className="upload-current-path">{installation.currentPath}</p>
      ) : null}
      {installation.error ? <p className="error-message compact">{installation.error}</p> : null}
    </div>
  );
}

async function registerPlayServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持 Service Worker。");
  }

  const registration = await navigator.serviceWorker.register("/play/sw.js", {
    scope: "/play/",
  });
  await registration.update().catch(() => undefined);
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 1500);

      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      registration.update().catch(() => undefined);
    });
  }
}

function focusPlayerCanvas(): void {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;

  canvas?.focus({ preventScroll: true });
}

async function requestBrowserStorage(): Promise<WebPlayStorageSnapshot> {
  const storage = navigator.storage;

  if (!storage) {
    return {
      persistedStorage: null,
      storageQuotaBytes: null,
      storageUsageBytes: null,
    };
  }

  const beforeEstimate = await storage.estimate?.().catch(() => null);
  let persistedStorage: boolean | null = null;

  if (typeof storage.persisted === "function") {
    persistedStorage = await storage.persisted().catch(() => false);
  }

  if (!persistedStorage && typeof storage.persist === "function") {
    persistedStorage = await storage.persist().catch(() => false);
  }

  const afterEstimate = await storage.estimate?.().catch(() => beforeEstimate);
  const estimate = afterEstimate ?? beforeEstimate;

  return {
    persistedStorage,
    storageQuotaBytes: estimate?.quota ?? null,
    storageUsageBytes: estimate?.usage ?? null,
  };
}

async function loadEasyRpgRuntime(runtimeBasePath: string): Promise<void> {
  if (window.createEasyRpgPlayer) {
    return;
  }

  const src = `${runtimeBasePath}/index.js`;
  const existing = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[data-easyrpg-runtime]"),
  ).find((script) => script.dataset.easyrpgRuntime === src);

  if (existing?.dataset.loaded === "true") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement("script");

    script.dataset.easyrpgRuntime = src;
    script.async = true;
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("EasyRPG runtime 加载失败。"));

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

function statusLabel(status: WebPlayInstallation["status"] | "deleted"): string {
  switch (status) {
    case "created":
      return "已创建";
    case "installing":
      return "安装中";
    case "ready":
      return "已安装";
    case "failed":
      return "安装失败";
    case "deleted":
      return "未安装";
  }
}

function percent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (done / total) * 100));
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  let next = value;

  for (const unit of ["B", "KB", "MB", "GB"]) {
    if (next < 1024 || unit === "GB") {
      return unit === "B" ? `${next} B` : `${next.toFixed(2)} ${unit}`;
    }

    next /= 1024;
  }

  return `${value} B`;
}
