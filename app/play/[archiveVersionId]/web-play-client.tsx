"use client";
import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteWebPlayInstallation,
  getWebPlayInstallation,
  markWebPlayLastPlayed,
} from "@/app/play/[archiveVersionId]/web-play-db";
import { resetGameOpfsDirectory } from "@/app/play/[archiveVersionId]/web-play-opfs";
import type {
  WebPlayInstallation,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
} from "@/app/play/[archiveVersionId]/web-play-types";
import { formatBytes } from "@/lib/format";
import { installStatusLabel } from "@/lib/labels";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";

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

export function WebPlayClient({ metadata, isAuthenticated }: { metadata: WebPlayMetadata; isAuthenticated: boolean }) {
  const [installation, setInstallation] = useState<WebPlayInstallation | null>(null);
  const [loadingLocalState, setLoadingLocalState] = useState(true);
  const [installSessionActive, setInstallSessionActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [playerStarting, setPlayerStarting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [logs, setLogs] = useState<WebPlayLog[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const moduleRef = useRef<EasyRpgModule | null>(null);

  const installed = installation?.status === "ready";
  const installing = installation?.status === "installing";
  const activeInstalling = installing && installSessionActive;
  const interruptedInstalling = installing && !installSessionActive;
  const failed = installation?.status === "failed";
  const playerBusy = running || playerStarting;

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetch(`/api/works/${metadata.workId}/played`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [isAuthenticated, metadata.workId]);

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
            addLog("warning", "检测到上次安装未完成。浏览器刷新或崩溃后，当前版本会清理并重新安装。");
          }
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          addLog("warning", error instanceof Error ? error.message : "读取本地安装状态失败。");
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

      addLog("error", "游戏文件读取失败，请清理并重新安装。");
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

      await resetGameOpfsDirectory(metadata.playKey);
      await deleteWebPlayInstallation(metadata.playKey);
      setInstallation(null);
      addLog("info", "已删除本地游戏文件。游戏存档不受影响。");
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
        throw new Error("游戏运行组件未正确加载，请刷新页面后重试。");
      }

      setRunning(true);
      addLog("info", "游戏运行组件已加载，正在启动游戏。");
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
      addLog("warning", "当前浏览器不支持全屏功能。");
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
      { label: "本地状态", value: installStatusLabel(installation.status) },
      {
        label: "长期保存",
        value: installation.persistedStorage === null ? "未请求" : installation.persistedStorage ? "已允许" : "未允许",
      },
      {
        label: "浏览器用量",
        value: formatBytes(installation.storageUsageBytes ?? 0),
      },
      {
        label: "浏览器额度",
        value: formatBytes(installation.storageQuotaBytes ?? 0),
      },
    ];
  }, [installation]);

  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]"
      data-web-play-status={loadingLocalState ? "loading" : (installation?.status ?? "deleted")}
    >
      <aside className="grid gap-3">
        <Pane>
          <SectionHeading
            action={
              <StatusBadge
                kind="browser-install"
                value={loadingLocalState ? "loading" : (installation?.status ?? "deleted")}
              />
            }
            eyebrow="EasyRPG Web Player"
            title="浏览器本地安装"
          />

          <StatList
            columns={2}
            items={[
              {
                label: "文件大小",
                value: formatBytes(metadata.totalSizeBytes),
              },
              {
                label: "文件数",
                value: metadata.totalFiles.toLocaleString("zh-CN"),
              },
              {
                label: "安装内容",
                value: `${formatBytes(metadata.installTotalSizeBytes)} / ${metadata.installTotalFiles.toLocaleString("zh-CN")} 文件`,
              },
            ]}
            variant="tiles"
          />

          {storageSummary ? <StatList columns={2} items={storageSummary} variant="tiles" /> : null}

          {installation ? <InstallProgress installation={installation} /> : null}
          {interruptedInstalling ? (
            <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">
              上次安装没有正常结束。请清理并重装本地缓存。
            </p>
          ) : null}
          {operationError ? (
            <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">{operationError}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {!installed && !installing ? (
              <Button data-web-play-action="install" onClick={startInstall} type="button">
                安装到浏览器
              </Button>
            ) : null}
            {activeInstalling ? (
              <Button variant="outline" onClick={cancelInstall} type="button">
                取消安装
              </Button>
            ) : null}
            {failed || interruptedInstalling ? (
              <Button onClick={startInstall} type="button">
                清理并重装
              </Button>
            ) : null}
            {installed ? (
              <>
                <Button disabled={playerBusy} onClick={startPlayer} type="button">
                  {running ? "运行中" : playerStarting ? "启动中" : "启动游戏"}
                </Button>
                <Button variant="outline" disabled={!running} onClick={requestFullscreen} type="button">
                  全屏
                </Button>
                <Button variant="outline" disabled={playerBusy} onClick={() => setDeleteDialogOpen(true)} type="button">
                  删除本地缓存
                </Button>
                <Button variant="outline" disabled={playerBusy} onClick={startInstall} type="button">
                  重新安装
                </Button>
              </>
            ) : null}
          </div>
          <AlertDialog onOpenChange={setDeleteDialogOpen} open={deleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogTitle>删除本地游戏缓存？</AlertDialogTitle>
              <AlertDialogDescription>
                已下载的本地游戏文件将被删除，浏览器存档不会受到影响。之后需要重新安装才能在线游玩。
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="outline">取消</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    onClick={() => {
                      setDeleteDialogOpen(false);
                      void deleteLocalInstall();
                    }}
                    variant="destructive"
                  >
                    删除缓存
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Pane>

        <details className="rounded-lg border border-border bg-card p-4">
          <summary>
            <span>运行日志</span>
            <span className="inline-flex min-h-5 items-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
              {logs.length}
            </span>
          </summary>
          <div className="font-mono text-xs">
            {logs.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setLogs([])} type="button">
                    清空
                  </Button>
                </div>
                <ol className="max-h-64 overflow-y-auto">
                  {logs.map((log) => (
                    <li className={log.level} key={log.id}>
                      <span>{new Date(log.createdAt).toLocaleTimeString("zh-CN")}</span>
                      <p>{log.message}</p>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p>暂无日志。</p>
            )}
          </div>
        </details>
      </aside>

      <div className="min-w-0">
        <Pane>
          <SectionHeading
            action={<StatusBadge kind="player" value={running ? "running" : playerStarting ? "starting" : "idle"} />}
            title="游戏画面"
          />
          <div className="grid gap-3">
            <div
              className="relative min-h-[min(62vh,520px)] overflow-hidden rounded-md border border-border bg-black focus-within:ring-2 focus-within:ring-accent"
              id="web-player-frame"
            >
              <canvas id="canvas" tabIndex={0} />
            </div>
            <div id="status" className="text-sm text-muted">
              {running ? "EasyRPG 正在运行" : "未启动"}
            </div>
          </div>
        </Pane>
      </div>
    </div>
  );
}

function InstallProgress({ installation }: { installation: WebPlayInstallation }) {
  const downloadPercent = percent(installation.downloadedBytes, installation.downloadBytesTotal);
  const extractPercent =
    installation.totalSizeBytes > 0
      ? percent(installation.installedBytes, installation.totalSizeBytes)
      : percent(installation.installedFiles, installation.totalFiles);

  return (
    <div className="grid gap-2">
      <div>
        <span>下载进度</span>
        <strong>
          {formatBytes(installation.downloadedBytes)} / {formatBytes(installation.downloadBytesTotal)}
        </strong>
      </div>
      <Progress aria-label="下载进度" value={downloadPercent} />
      <div>
        <span>安装进度</span>
        <strong>
          {installation.installedFiles.toLocaleString("zh-CN")} / {installation.totalFiles.toLocaleString("zh-CN")} 文件
        </strong>
      </div>
      <Progress aria-label="安装进度" value={extractPercent} />
      {installation.error ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800 text-sm">{installation.error}</p>
      ) : null}
    </div>
  );
}

async function registerPlayServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持在线游玩所需的后台功能。");
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
  const existing = Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-easyrpg-runtime]")).find(
    (script) => script.dataset.easyrpgRuntime === src,
  );

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
    script.onerror = () => reject(new Error("游戏运行组件加载失败，请刷新页面后重试。"));

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

function percent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (done / total) * 100));
}
