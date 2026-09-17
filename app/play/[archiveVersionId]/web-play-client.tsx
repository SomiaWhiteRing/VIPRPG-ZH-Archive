import { Notice } from "@/app/components/ui/notice";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { DetailPageLayout } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Progress } from "@/app/components/ui/progress";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { createPlayerSession } from "./web-play-player";
import type { PlayerLogLevel, PlayerSession } from "./web-play-player";
import { WebPlayScreenshotGallery } from "./web-play-screenshot-gallery";
import { useWebPlayScreenshots } from "./web-play-screenshots";
import { WorkSidebar } from "@/app/components/work/work-page-layout";
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
import {
  Camera,
  Expand,
  Maximize,
  Minimize2,
  Play,
  RectangleHorizontal,
  RectangleVertical,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WebPlayLog = {
  id: string;
  level: PlayerLogLevel;
  message: string;
  createdAt: string;
};

type DisplayOrientation = "landscape" | "portrait";

const mobileControlsQuery = "(hover: none) and (pointer: coarse)";

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: DisplayOrientation) => Promise<void>;
  unlock?: () => void;
};

type WebPlayClientProps = {
  comments: ReactNode;
  engagement: ReactNode;
  isAuthenticated: boolean;
  metadata: WebPlayMetadata;
  notice?: ReactNode;
  secondary: ReactNode;
  stats: ReactNode;
};

export function WebPlayClient({
  comments,
  engagement,
  isAuthenticated,
  metadata,
  notice,
  secondary,
  stats,
}: WebPlayClientProps) {
  const [installation, setInstallation] = useState<WebPlayInstallation | null>(
    null,
  );
  const [loadingLocalState, setLoadingLocalState] = useState(true);
  const [installSessionActive, setInstallSessionActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [playerStarting, setPlayerStarting] = useState(false);
  const [playerStopping, setPlayerStopping] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [logs, setLogs] = useState<WebPlayLog[]>([]);
  const [copyingLogs, setCopyingLogs] = useState(false);
  const [copyLogsMessage, setCopyLogsMessage] = useState<string | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const [mobileControls, setMobileControls] = useState(false);
  const [displayOrientation, setDisplayOrientation] =
    useState<DisplayOrientation>("landscape");
  const [orientationLockActive, setOrientationLockActive] = useState(false);
  const [viewportPortrait, setViewportPortrait] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerSession | null>(null);
  const lifetimeRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const {
    screenshots,
    loading: loadingScreenshots,
    capturing,
    message: screenshotMessage,
    capture,
  } = useWebPlayScreenshots(metadata.workId);

  const installed = installation?.status === "ready";
  const installing = installation?.status === "installing";
  const activeInstalling = installing && installSessionActive;
  const interruptedInstalling = installing && !installSessionActive;
  const failed = installation?.status === "failed";
  const playerBusy = running || playerStarting;
  const immersive = nativeFullscreen || pageFullscreen;
  const captureDisabled = !running || playerStopping || loadingScreenshots || capturing;

  const captureScreenshot = useCallback(async () => {
    const player = playerRef.current;
    if (!player || captureDisabled) return;
    focusPlayerCanvas();
    await capture(player);
    if (playerRef.current === player) focusPlayerCanvas();
  }, [capture, captureDisabled]);

  const addLog = useCallback(
    (level: WebPlayLog["level"], message: string) => {
      setLogs((current) =>
        [
          {
            id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
            level,
            message: message.slice(0, 16_000),
            createdAt: new Date().toISOString(),
          },
          ...current,
        ].slice(0, 300),
      );
    },
    [],
  );

  const copyLogs = useCallback(async () => {
    setCopyingLogs(true);
    setCopyLogsMessage(null);
    try {
      await navigator.clipboard.writeText(logs.map(formatLog).join("\n"));
      setCopyLogsMessage(`已复制 ${logs.length} 条日志。`);
    } catch {
      setCopyLogsMessage("复制失败，请允许浏览器访问剪贴板后重试。");
    } finally {
      setCopyingLogs(false);
    }
  }, [logs]);

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    return () => {
      lifetime.abort();
      playerRef.current?.dispose();
      playerRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      unlockScreenOrientation();
    };
  }, []);

  useNavigationGuard(installSessionActive, () =>
    window.confirm("游戏安装尚未完成，确定离开并中断安装吗？"),
  );

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

      if (
        message.type !== "web-play-file-missing" ||
        message.playKey !== metadata.playKey
      ) {
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
    const frame = document.getElementById("web-player-frame");

    const onFullscreenChange = () => {
      const active = document.fullscreenElement === frame;
      setNativeFullscreen(active);
      if (!active) {
        unlockScreenOrientation();
        setOrientationLockActive(false);
      }
      if (active) focusPlayerCanvas();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(orientation: portrait)");
    const mobileQuery = window.matchMedia(mobileControlsQuery);
    const update = () => {
      setViewportPortrait(query.matches);
      setMobileControls(mobileQuery.matches);
    };
    update();
    query.addEventListener("change", update);
    mobileQuery.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
      mobileQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!pageFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pageFullscreen]);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(
      new URL("./web-play-install-worker.ts", import.meta.url),
      {
        type: "module",
      },
    );

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
    const signal = lifetimeRef.current!.signal;
    setOperationError(null);

    try {
      if (playerBusy) {
        throw new Error("游戏运行中不能重装本地缓存。");
      }

      setInstallSessionActive(true);
      const storageSnapshot = await requestBrowserStorage();
      signal.throwIfAborted();
      await registerPlayServiceWorker(signal);
      signal.throwIfAborted();
      const worker = ensureWorker();

      worker.postMessage({
        type: "install",
        metadata,
        storageSnapshot,
      } satisfies WebPlayInstallWorkerInput);
      addLog("info", "开始下载并安装到浏览器本地。");
    } catch (error) {
      if (signal.aborted) return;
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
      const message =
        error instanceof Error ? error.message : "删除本地缓存失败。";
      setOperationError(message);
      addLog("error", message);
    }
  }, [addLog, metadata.playKey, playerBusy]);

  const startPlayer = useCallback(async (): Promise<boolean> => {
    if (running) return true;
    if (startingRef.current) return false;
    const signal = lifetimeRef.current!.signal;
    setOperationError(null);

    try {
      if (!installed) {
        throw new Error("需要先完成本地安装。");
      }

      startingRef.current = true;
      setPlayerStarting(true);
      await registerPlayServiceWorker(signal);
      signal.throwIfAborted();
      if (!playerHostRef.current) return false;
      const player = createPlayerSession(playerHostRef.current, metadata, addLog);
      playerRef.current = player;
      await player.ready;
      signal.throwIfAborted();
      setRunning(true);
      focusPlayerCanvas();
      await markWebPlayLastPlayed(metadata.playKey);
      signal.throwIfAborted();
      if (isAuthenticated) {
        void fetch(`/api/works/${metadata.workId}/played`, {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
        }).catch(() => undefined);
      }
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      playerRef.current?.dispose();
      playerRef.current = null;
      const message =
        error instanceof Error ? error.message : "启动在线游玩失败。";
      setOperationError(message);
      addLog("error", message);
      setRunning(false);
      return false;
    } finally {
      startingRef.current = false;
      if (!signal.aborted) setPlayerStarting(false);
    }
  }, [addLog, installed, isAuthenticated, metadata, running]);

  const lockOrientation = useCallback(
    async (next: DisplayOrientation): Promise<boolean> => {
      const orientation = screen.orientation as LockableScreenOrientation;
      if (typeof orientation?.lock !== "function") {
        setOrientationLockActive(false);
        setDisplayMessage(
          "浏览器不能锁定屏幕方向；画面已按所选方向铺满，请旋转设备。",
        );
        return false;
      }

      try {
        await orientation.lock(next);
        setOrientationLockActive(true);
        setDisplayMessage(null);
        return true;
      } catch {
        setOrientationLockActive(false);
        setDisplayMessage(
          "浏览器未允许锁定屏幕方向；画面已按所选方向铺满，请旋转设备。",
        );
        return false;
      }
    },
    [],
  );

  const enterImmersive = useCallback(
    async (next: DisplayOrientation): Promise<boolean> => {
      const frame = document.getElementById("web-player-frame");
      if (!frame) {
        setOperationError("找不到游戏画面，无法进入全屏。请刷新页面后重试。");
        return false;
      }

      setDisplayOrientation(next);
      setDisplayMessage(null);

      if (document.fullscreenEnabled && frame.requestFullscreen) {
        try {
          await frame.requestFullscreen({ navigationUI: "hide" });
          setNativeFullscreen(true);
          setPageFullscreen(false);
          if (mobileControls) await lockOrientation(next);
          focusPlayerCanvas();
          return true;
        } catch {
          addLog("warning", "浏览器未进入原生全屏，已改为铺满页面。");
        }
      }

      setNativeFullscreen(false);
      setPageFullscreen(true);
      if (mobileControls) await lockOrientation(next);
      focusPlayerCanvas();
      return true;
    },
    [addLog, lockOrientation, mobileControls],
  );

  const enterPageFullscreen = useCallback(() => {
    setPageFullscreen(true);
    setDisplayMessage(null);
    focusPlayerCanvas();
  }, []);

  const exitImmersive = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setPageFullscreen(false);
    setNativeFullscreen(false);
    unlockScreenOrientation();
    setOrientationLockActive(false);
    setDisplayMessage(null);
    focusPlayerCanvas();
  }, []);

  const stopPlayer = useCallback(async () => {
    if (startingRef.current || !playerRef.current) return;
    setPlayerStopping(true);
    playerRef.current.dispose();
    playerRef.current = null;
    await exitImmersive();
    if (lifetimeRef.current?.signal.aborted) return;
    setRunning(false);
    setPlayerStopping(false);
    addLog("info", "游戏已停止。");
  }, [addLog, exitImmersive]);

  const startDefaultPlayer = useCallback(async () => {
    if (running || startingRef.current) return;
    // Request fullscreen during the tap so mobile browsers retain user activation.
    const fullscreenRequest = mobileControls ? enterImmersive("landscape") : null;
    const started = await startPlayer();
    await fullscreenRequest;
    if (lifetimeRef.current?.signal.aborted) return;
    if (!started && mobileControls) await exitImmersive();
  }, [enterImmersive, exitImmersive, mobileControls, running, startPlayer]);

  const changeDisplayOrientation = useCallback(
    async (next: DisplayOrientation) => {
      setDisplayOrientation(next);
      if (nativeFullscreen) {
        await lockOrientation(next);
      } else {
        setOrientationLockActive(false);
        setDisplayMessage(
          "画面已切换方向；如设备没有自动旋转，请手动旋转设备。",
        );
      }
      focusPlayerCanvas();
    },
    [lockOrientation, nativeFullscreen],
  );

  const storageSummary = useMemo(() => {
    if (!installation) {
      return null;
    }

    return [
      { label: "本地状态", value: installStatusLabel(installation.status) },
      {
        label: "长期保存",
        value:
          installation.persistedStorage === null
            ? "未请求"
            : installation.persistedStorage
              ? "已允许"
              : "未允许",
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

  const rotation =
    immersive && mobileControls && !orientationLockActive
      ? displayOrientation === "landscape" && viewportPortrait
        ? 90
        : displayOrientation === "portrait" && !viewportPortrait
          ? -90
          : 0
      : 0;
  const playerSurfaceClass =
    rotation === 90
      ? "absolute left-1/2 top-1/2 h-[100dvw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 rotate-90"
      : rotation === -90
        ? "absolute left-1/2 top-1/2 h-[100dvw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 -rotate-90"
        : "absolute inset-0";

  return (
    <div
      data-web-play-status={
        loadingLocalState ? "loading" : (installation?.status ?? "deleted")
      }
    >
      <DetailPageLayout
        sidebarLabel="作品操作与资料"
        main={
          <>
            <section aria-labelledby="player-title" className="py-4.5">
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="player-title">
                  游戏画面
                </h2>
                <span className="font-mono text-xs text-muted">
                  {running ? "运行中" : playerStarting ? "启动中" : "待机"}
                </span>
              </div>
              <div className="aspect-4/3 w-full">
                <div
                  className={
                    immersive
                      ? "fixed inset-0 z-[100] h-[100dvh] w-screen overflow-hidden border-0 bg-black focus-within:ring-2 focus-within:ring-accent"
                      : "relative h-full w-full overflow-hidden rounded-lg border border-border bg-black focus-within:ring-2 focus-within:ring-accent"
                  }
                  id="web-player-frame"
                >
                  <div
                    className={playerSurfaceClass}
                    id="web-player-surface"
                  >
                    <div
                      className="h-full w-full"
                      id="web-player-host"
                      ref={playerHostRef}
                    />
                    {!running ? (
                      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 p-6 text-center text-sm text-white/75">
                        {playerStarting
                          ? "正在启动 EasyRPG…"
                          : activeInstalling
                            ? "正在安装游戏文件…"
                            : installed
                              ? "游戏已准备好"
                              : "未安装"}
                      </div>
                    ) : null}
                  </div>

                  {immersive ? (
                    <div className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex flex-wrap justify-end gap-2">
                      {mobileControls && running ? (
                        <>
                          <Button
                            aria-pressed={displayOrientation === "landscape"}
                            className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                            onClick={() => void changeDisplayOrientation("landscape")}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <RectangleHorizontal aria-hidden />
                            横屏
                          </Button>
                          <Button
                            aria-pressed={displayOrientation === "portrait"}
                            className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                            onClick={() => void changeDisplayOrientation("portrait")}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <RectangleVertical aria-hidden />
                            竖屏
                          </Button>
                        </>
                      ) : null}
                      <Button
                        aria-label="恢复窗口"
                        className="border-white/30 bg-white/15 text-white shadow-lg backdrop-blur-md hover:border-white/60 hover:bg-white/25 hover:text-white"
                        onClick={() => void exitImmersive()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Minimize2 aria-hidden />
                        恢复
                      </Button>
                      <Button
                        aria-label={capturing ? "正在截取图片" : "截取图片"}
                        className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                        disabled={captureDisabled}
                        onClick={() => void captureScreenshot()}
                        size="icon"
                        title="截取图片"
                        type="button"
                        variant="outline"
                      >
                        <Camera aria-hidden />
                      </Button>
                    </div>
                  ) : null}

                  {immersive && (displayMessage || screenshotMessage) ? (
                    <div
                      className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-10 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md bg-black/75 px-3 py-2 text-center text-sm text-white"
                      role="status"
                    >
                      {displayMessage}
                      {displayMessage && screenshotMessage ? <br /> : null}
                      {screenshotMessage}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                <span id="status">
                  {running ? "EasyRPG 正在运行" : "未启动"}
                </span>
                {!immersive && screenshotMessage ? (
                  <span role="status">{screenshotMessage}</span>
                ) : null}
                {!immersive && displayMessage ? (
                  <span role="status">{displayMessage}</span>
                ) : null}
              </div>
            </section>

            <section
              aria-labelledby="comments-title"
              className="scroll-mt-20 border-t border-border py-4.5"
              id="sec-comments"
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="comments-title">
                  评论
                </h2>
                <span className="font-mono text-xs text-muted max-[560px]:text-left">
                  按发帖时间排序
                </span>
              </div>
              {comments}
            </section>
          </>
        }
        sidebar={
          <WorkSidebar
            extras={<WebPlayScreenshotGallery screenshots={screenshots} title={metadata.title} />}
            mobilePrimaryFirst
            notice={notice}
            primary={
              <div className="grid gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="m-0 text-base font-bold">在线游玩</h2>
                  <span className="font-mono text-xs text-muted">
                    {loadingLocalState
                      ? "读取中"
                      : installStatusLabel(installation?.status ?? "deleted")}
                  </span>
                </div>

                {interruptedInstalling ? (
                  <Notice
                    tone="error"
                    className="m-0 rounded-md border p-3 text-sm"
                  >
                    上次安装没有正常结束。请清理并重新安装。
                  </Notice>
                ) : null}
                {operationError ? (
                  <Notice
                    tone="error"
                    className="m-0 rounded-md border p-3 text-sm"
                    role="alert"
                  >
                    {operationError}
                  </Notice>
                ) : null}

                {activeInstalling && installation ? (
                  <InstallProgress installation={installation} />
                ) : null}

                {loadingLocalState ? (
                  <Button className="w-full" disabled type="button">
                    读取本地状态…
                  </Button>
                ) : activeInstalling ? (
                  <Button
                    className="w-full"
                    onClick={cancelInstall}
                    type="button"
                    variant="outline"
                  >
                    取消安装
                  </Button>
                ) : failed || interruptedInstalling ? (
                  <Rm2kButton
                    className="w-full"
                    data-web-play-action="install"
                    onClick={startInstall}
                    type="button"
                  >
                    清理并重装
                  </Rm2kButton>
                ) : installed ? (
                  !running ? (
                    <Rm2kButton
                      className="min-h-12.5 w-full text-base"
                      data-web-play-action="start"
                      disabled={playerStarting}
                      icon={<Play aria-hidden />}
                      onClick={() => void startDefaultPlayer()}
                      type="button"
                    >
                      {playerStarting ? "正在启动…" : "启动游戏"}
                    </Rm2kButton>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2">
                      <Button
                        className="min-w-0 gap-1.5 px-2"
                        disabled={playerStopping}
                        onClick={enterPageFullscreen}
                        type="button"
                        variant="outline"
                      >
                        <Maximize aria-hidden />
                        网页全屏
                      </Button>
                      <Button
                        className="min-w-0 gap-1.5 px-2"
                        disabled={playerStopping}
                        onClick={() => void enterImmersive(displayOrientation)}
                        type="button"
                        variant="outline"
                      >
                        <Expand aria-hidden />
                        全屏幕
                      </Button>
                      <Button
                        aria-label={capturing ? "正在截取图片" : "截取图片"}
                        disabled={captureDisabled}
                        onClick={() => void captureScreenshot()}
                        size="icon"
                        title="截取图片"
                        type="button"
                        variant="outline"
                      >
                        <Camera aria-hidden />
                      </Button>
                    </div>
                  )
                ) : (
                  <Rm2kButton
                    className="w-full"
                    data-web-play-action="install"
                    onClick={startInstall}
                    type="button"
                  >
                    安装到浏览器 · {formatBytes(metadata.totalSizeBytes)}
                  </Rm2kButton>
                )}

                {engagement}

                <details className="border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-foreground">
                    本地数据与诊断
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <dl className="grid gap-2 text-xs">
                      <DiagnosticRow
                        label="归档内容"
                        value={`${formatBytes(metadata.totalSizeBytes)} / ${metadata.totalFiles.toLocaleString("zh-CN")} 文件`}
                      />
                      <DiagnosticRow
                        label="安装内容"
                        value={`${formatBytes(metadata.installTotalSizeBytes)} / ${metadata.installTotalFiles.toLocaleString("zh-CN")} 文件`}
                      />
                      {storageSummary?.map((item) => (
                        <DiagnosticRow
                          key={item.label}
                          label={item.label}
                          value={item.value}
                        />
                      ))}
                    </dl>

                    {installation && !activeInstalling ? (
                      <InstallProgress installation={installation} compact />
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {running ? (
                        <Button
                          disabled={playerStarting || playerStopping}
                          onClick={() => void stopPlayer()}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {playerStopping ? "正在停止…" : "停止游戏"}
                        </Button>
                      ) : null}
                      {installed || failed || interruptedInstalling ? (
                        <Button
                          disabled={playerBusy}
                          onClick={startInstall}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          重新安装
                        </Button>
                      ) : null}
                      {installation ? (
                        <Button
                          aria-controls="delete-local-cache-dialog"
                          aria-expanded={deleteDialogOpen}
                          aria-haspopup="dialog"
                          ref={deleteButtonRef}
                          disabled={playerBusy}
                          onClick={() => setDeleteDialogOpen(true)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          删除本地缓存
                        </Button>
                      ) : null}
                    </div>

                    <div className="border-t border-border pt-3 font-mono text-xs">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <strong>运行日志 · {logs.length}</strong>
                        {logs.length ? (
                          <div className="flex items-center gap-1">
                            <Button
                              disabled={copyingLogs}
                              onClick={() => void copyLogs()}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              {copyingLogs ? "复制中…" : "复制"}
                            </Button>
                            <Button
                              disabled={copyingLogs}
                              onClick={() => {
                                setLogs([]);
                                setCopyLogsMessage(null);
                              }}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              清空
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {copyLogsMessage ? (
                        <p className="mb-2 text-muted" role="status">
                          {copyLogsMessage}
                        </p>
                      ) : null}
                      {logs.length ? (
                        <ol className="m-0 grid max-h-64 list-none gap-1 overflow-y-auto p-0">
                          {logs.map((log) => (
                            <li
                              className={`${logTone(log.level)} whitespace-pre-wrap wrap-anywhere`}
                              key={log.id}
                            >
                              {formatLog(log)}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <EmptyState
                          title="暂无日志。"
                          variant="plain"
                          className="text-xs"
                        />
                      )}
                    </div>
                  </div>
                </details>

                <AlertDialog
                  onOpenChange={setDeleteDialogOpen}
                  open={deleteDialogOpen}
                >
                  <AlertDialogContent
                    id="delete-local-cache-dialog"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      deleteButtonRef.current?.focus();
                    }}
                  >
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
              </div>
            }
            secondary={secondary}
            stats={stats}
          />
        }
      />
    </div>
  );
}

function InstallProgress({
  installation,
  compact = false,
}: {
  installation: WebPlayInstallation;
  compact?: boolean;
}) {
  const downloadPercent = percent(
    installation.downloadedBytes,
    installation.downloadBytesTotal,
  );
  const extractPercent =
    installation.totalSizeBytes > 0
      ? percent(installation.installedBytes, installation.totalSizeBytes)
      : percent(installation.installedFiles, installation.totalFiles);

  return (
    <div className={`grid gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="flex items-center justify-between gap-3">
        <span>下载进度</span>
        <strong className="text-right font-medium">
          {formatBytes(installation.downloadedBytes)} /{" "}
          {formatBytes(installation.downloadBytesTotal)}
        </strong>
      </div>
      <Progress aria-label="下载进度" value={downloadPercent} />
      <div className="flex items-center justify-between gap-3">
        <span>安装进度</span>
        <strong className="text-right font-medium">
          {installation.installedFiles.toLocaleString("zh-CN")} /{" "}
          {installation.totalFiles.toLocaleString("zh-CN")} 文件
        </strong>
      </div>
      <Progress aria-label="安装进度" value={extractPercent} />
      {installation.error ? (
        <Notice tone="error" className="m-0 rounded-md border p-3 text-sm">
          {installation.error}
        </Notice>
      ) : null}
    </div>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-border/70 border-b pb-2 last:border-b-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 max-w-48 text-right text-foreground">{value}</dd>
    </div>
  );
}

function logTone(level: WebPlayLog["level"]): string {
  if (level === "error") return "text-red-700";
  if (level === "warning") return "text-amber-700";
  return "text-muted";
}

function formatLog(log: WebPlayLog): string {
  const time = new Date(log.createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return log.message.split(/\r?\n/).map((line) => `[${time}]${line}`).join("\n");
}

function unlockScreenOrientation(): void {
  const orientation = screen.orientation as
    | LockableScreenOrientation
    | undefined;
  orientation?.unlock?.();
}

async function registerPlayServiceWorker(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持在线游玩所需的后台功能。");
  }

  const registration = await navigator.serviceWorker.register("/play/sw.js", {
    scope: "/play/",
  });
  await registration.update().catch(() => undefined);
  signal.throwIfAborted();
  // Play links load a document inside /play/. SPA navigation from another scope
  // cannot give that document control, even when the registration is active.
  const scriptUrl = new URL("/play/sw.js", window.location.origin).href;
  const controlled = () =>
    navigator.serviceWorker.controller?.scriptURL === scriptUrl;
  if (controlled()) return;

  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControl,
      );
      signal.removeEventListener("abort", onAbort);
    }
    function onControl() {
      if (!controlled()) return;
      cleanup();
      resolve();
    }
    function onAbort() {
      cleanup();
      reject(signal.reason);
    }
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("在线游玩初始化超时，请刷新页面后重试。"));
    }, 10_000);
    navigator.serviceWorker.addEventListener("controllerchange", onControl);
    signal.addEventListener("abort", onAbort, { once: true });
    onControl();
  });
}

function focusPlayerCanvas(): void {
  const canvas = document
    .querySelector<HTMLIFrameElement>("#web-player-host iframe")
    ?.contentDocument?.querySelector<HTMLCanvasElement>("#canvas");

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

function percent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (done / total) * 100));
}
