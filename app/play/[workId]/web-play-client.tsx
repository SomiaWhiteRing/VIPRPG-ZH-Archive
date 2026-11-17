import { useConfirm } from "@/app/components/ui/confirm-provider";
import { Notice } from "@/app/components/ui/notice";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { useToast } from "@/app/components/ui/toast";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { setAndroidOnlinePlaying } from "@/lib/browser/android-screenshots";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { reportWorkPlayed } from "@/lib/browser/work-play";
import { canTrackAnalytics, trackAnalytics } from "@/lib/browser/site-analytics";
import { analyticsDurationBucket, analyticsSizeBucket } from "@/lib/analytics";

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
import { useDocumentNavigationGuard, useRouterNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { createPlayerSession } from "./web-play-player";
import type { PlayerLogLevel, PlayerSession } from "./web-play-player";
import { WebPlaySurface } from "./web-play-surface";
import { WebPlayControlsHelp } from "./web-play-controls-help";
import { useWebPlayControlsPreferences } from "./web-play-controls-preferences";
import type { DisplayOrientation } from "./web-play-controls-preferences";
import { WebPlayScreenshotGallery } from "./web-play-screenshot-gallery";
import { useWebPlayScreenshots } from "./web-play-screenshots";
import { WebPlaySaveExport } from "./web-play-save-export";
import { WorkSidebar } from "@/app/components/work/work-page-layout";
import {
  getWebPlayInstallation,
  listWebPlayInstallations,
} from "@/app/play/[workId]/web-play-db";
import { canManageGameResources, cleanupExpiredGameResources, cleanupObsoleteGameResources, deleteLocalGame } from "./web-play-cleanup";
import { chooseGameStorage } from "./web-play-storage";
import { subscribeGameResourcesChanged } from "./web-play-events";
import { createInstallWorker, InstallDiagnosticsPanel } from "./web-play-install-worker-entry";
import type {
  WebPlayInstallation,
  WebPlayInstallErrorMessage,
  WebPlayInstallWorkerInput,
  WebPlayInstallWorkerOutput,
  WebPlayMetadata,
  WebPlayStorageSnapshot,
} from "@/app/play/[workId]/web-play-types";
import { DISPLAY_TIME_ZONE, formatBytes, parseTimestamp } from "@/lib/format";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { requestJson } from "@/lib/ui/api-response";
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
  errorMessage?: WebPlayInstallErrorMessage;
  reasonMessage?: WebPlayInstallErrorMessage;
  createdAt: string;
};

type BrowserStorageStatus = WebPlayStorageSnapshot & {
  protectionStatus: "granted" | "denied" | "unsupported" | "queryFailed" | "requestFailed";
};

const mobileControlsQuery = "(hover: none) and (pointer: coarse)";

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: DisplayOrientation) => Promise<void>;
  unlock?: () => void;
};

type WebPlayClientProps = {
  comments: ReactNode;
  engagement: ReactNode;
  metadata: WebPlayMetadata;
  notice?: ReactNode;
  secondary: ReactNode;
  stats: ReactNode;
};

export function WebPlayClient({
  comments,
  engagement,
  metadata: providedMetadata,
  notice,
  secondary,
  stats,
}: WebPlayClientProps) {
  const t = useMessages();
  const locale = useUiLocale();
  const toast = useToast();
  const clientEnvironment = useClientEnvironment();
  const [metadata, setMetadata] = useState(providedMetadata);
  const [availableMetadata, setAvailableMetadata] = useState(providedMetadata);
  const [hasPreviousInstallation, setHasPreviousInstallation] = useState(false);
  const automaticInstallAttempts = useRef(new Set<string>());
  const [installation, setInstallation] = useState<WebPlayInstallation | null>(
    null,
  );
  const [loadingLocalState, setLoadingLocalState] = useState(true);
  const [installSessionActive, setInstallSessionActive] = useState(false);
  const installSessionRef = useRef(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [playerStarting, setPlayerStarting] = useState(false);
  const [playerStopping, setPlayerStopping] = useState(false);
  const [operationError, setOperationError] = useState<string | WebPlayInstallErrorMessage | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [logs, setLogs] = useState<WebPlayLog[]>([]);
  const [copyingLogs, setCopyingLogs] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const [mobileControls, setMobileControls] = useState(false);
  const {
    preferences: controlsPreferences,
    setOrientation: setDisplayOrientation,
    setTouchEnabled,
    saveLayout,
  } = useWebPlayControlsPreferences();
  const displayOrientation = controlsPreferences.orientation;
  const [orientationLockActive, setOrientationLockActive] = useState(false);
  const [viewportPortrait, setViewportPortrait] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const analyticsInstallStarted = useRef<number | null>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerSession | null>(null);
  const lifetimeRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const pendingLogs = useRef<WebPlayLog[]>([]);
  const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    screenshots,
    loading: loadingScreenshots,
    capturing,
    capture,
    remove: removeScreenshots,
  } = useWebPlayScreenshots(metadata.workId, metadata.title);
  const captureRef = useRef(capture);
  useEffect(() => { captureRef.current = capture; }, [capture]);

  const installed = installation?.status === "ready";
  const installing = installation?.status === "installing";
  const installAction = hasPreviousInstallation ? "update" : "install";
  const localStatusLabel = installSessionActive || installing
    ? t("play.install.inProgress", { action: installAction })
    : hasPreviousInstallation && !installed
      ? installation?.status === "failed" ? t("play.install.updateFailed") : t("play.install.pendingUpdate")
      : t(`play.install.status.${installation?.status ?? "deleted"}`);
  const interruptedInstalling = installing && !installSessionActive;
  const failed = installation?.status === "failed";
  const playerBusy = running || playerStarting;
  const immersive = nativeFullscreen || pageFullscreen;
  const desktopControlsHelp = clientEnvironment === "browser" && !mobileControls;
  const captureDisabled = !running || playerStopping || loadingScreenshots || capturing;

  useEffect(() => { setAvailableMetadata(providedMetadata); }, [providedMetadata]);

  // A running game keeps its resource and room-service version until it stops.
  useEffect(() => {
    if (playerBusy || installSessionActive || availableMetadata === metadata) return;
    if (availableMetadata.playKey !== metadata.playKey) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setInstallation(null);
      setHasPreviousInstallation(false);
      setLoadingLocalState(true);
    }
    setMetadata(availableMetadata);
  }, [availableMetadata, installSessionActive, metadata, playerBusy]);

  const checkForUpdate = useCallback(async () => {
    if (!navigator.onLine) return null;
    const next = await requestJson<WebPlayMetadata>(
      `/api/works/${metadata.workId}/web-play${window.location.search}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (next && !lifetimeRef.current?.signal.aborted) setAvailableMetadata(next);
    return next;
  }, [metadata.workId]);

  useEffect(() => {
    if (playerBusy || installSessionActive) return;
    const check = () => { if (!document.hidden) void checkForUpdate(); };
    check();
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkForUpdate, installSessionActive, playerBusy]);

  useEffect(() => {
    setAndroidOnlinePlaying(playerBusy, immersive);
  }, [playerBusy, immersive]);

  useEffect(() => {
    return () => setAndroidOnlinePlaying(false, false);
  }, []);

  const captureScreenshot = useCallback(async () => {
    const player = playerRef.current;
    if (!player || captureDisabled) return;
    focusPlayerCanvas();
    await capture(() => player.captureScreenshot());
    if (playerRef.current === player) focusPlayerCanvas();
  }, [capture, captureDisabled]);

  const addLog = useCallback(
    (level: WebPlayLog["level"], message: string, feedback?: Pick<WebPlayLog, "errorMessage" | "reasonMessage">) => {
      if (lifetimeRef.current?.signal.aborted) return;
      pendingLogs.current.push({
        id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
        level,
        message: message.slice(0, 16_000),
        ...feedback,
        createdAt: new Date().toISOString(),
      });
      if (pendingLogs.current.length > 300) pendingLogs.current.shift();
      // Per-frame engine warnings must not starve navigation transitions.
      logTimer.current ??= setTimeout(() => {
        const batch = pendingLogs.current.splice(0).reverse();
        logTimer.current = null;
        setLogs(current => [...batch, ...current].slice(0, 300));
      }, 200);
    },
    [],
  );

  const copyLogs = useCallback(async () => {
    setCopyingLogs(true);
    try {
      await navigator.clipboard.writeText(logs.map((log) => formatLog(log, t)).join("\n"));
      toast.success(t("play.diagnostic.copied", { count: logs.length }));
    } catch {
      toast.error(t("play.diagnostic.copyFailed"));
    } finally {
      setCopyingLogs(false);
    }
  }, [logs, t, toast]);

  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    return () => {
      lifetime.abort();
      if (logTimer.current !== null) clearTimeout(logTimer.current);
      logTimer.current = null;
      pendingLogs.current = [];
      playerRef.current?.dispose();
      playerRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      unlockScreenOrientation();
    };
  }, []);

  const confirm = useConfirm();
  useDocumentNavigationGuard(installSessionActive || running || playerStarting);
  useRouterNavigationGuard(
    // Comment tabs and pagination keep this game's player mounted.
    ({ currentLocation, nextLocation }) => (installSessionActive || running || playerStarting) &&
      currentLocation.pathname !== nextLocation.pathname,
    async () => {
      if (installSessionActive) return confirm(t("play.install.leave", { action: installAction }));
      await exitImmersive();
      if (!(await confirm(t("play.diagnostic.leaveGame")))) {
        focusPlayerCanvas();
        return false;
      }
      try {
        await playerRef.current?.dispose();
        playerRef.current = null;
        setRunning(false);
        return true;
      } catch (error) {
        setOperationError(formatFeedbackError(error, locale, t("play.diagnostic.savePending")));
        return false;
      }
    },
  );

  useEffect(() => {
    if (!diagnosticsOpen || installSessionActive) return;
    let current = true;
    readBrowserStorage().then((snapshot) => {
      if (current) setBrowserStorage(snapshot);
    });
    return () => { current = false; };
  }, [diagnosticsOpen, installSessionActive]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (installSessionActive || playerBusy) return;
      try {
        await cleanupExpiredGameResources().catch(error => {
          if (mounted) addLog("warning", formatFeedbackError(error, locale, t("play.diagnostic.localCleanup")));
        });
        const value = await getWebPlayInstallation(metadata.playKey);
        const previous = value?.status === "ready" ? false : (await listWebPlayInstallations()).some(
          row => row.workId === metadata.workId && row.playKey !== metadata.playKey && row.status === "ready",
        );
        if (!mounted) return;
        setInstallation(value);
        if (value?.status !== "ready") setHasPreviousInstallation(previous);
        if (value?.status === "installing") {
          addLog("warning", t("play.diagnostic.unfinished"));
        }
      } catch (error) {
        if (mounted) {
          addLog("warning", formatFeedbackError(error, locale, t("play.diagnostic.readState")));
        }
      } finally {
        if (mounted) setLoadingLocalState(false);
      }
    };
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    const unsubscribe = subscribeGameResourcesChanged(onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [addLog, metadata.playKey, metadata.workId, installSessionActive, playerBusy, locale, t]);


  useEffect(() => {
    if (!installed || installSessionActive || running || playerStarting) return;
    let current = true;
    void (async () => {
      const { removed, deferred } = await cleanupObsoleteGameResources(metadata);
      if (!current) return;
      if (deferred) addLog("info", t("play.diagnostic.cleanupDeferred"));
      if (removed.length === 0) return;
      addLog("info", t("play.diagnostic.cleanupDone", { count: removed.length }));
      setInstallation(await getWebPlayInstallation(metadata.playKey));
      const snapshot = await readBrowserStorage();
      if (current) setBrowserStorage(snapshot);
    })().catch((error: unknown) => {
      if (current) addLog("warning", t("play.diagnostic.cleanupRetry", { reason: formatFeedbackError(error, locale, t("play.diagnostic.retryNext")) }));
    });
    return () => { current = false; };
  }, [addLog, installed, installSessionActive, metadata, running, playerStarting, locale, t]);

  useEffect(() => {
    const frame = document.getElementById("web-player-frame");

    const onFullscreenChange = () => {
      const active = document.fullscreenElement === frame;
      setNativeFullscreen(active);
      if (active) {
        setPageFullscreen(false);
      } else {
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

    const worker = createInstallWorker();

    worker.onmessage = (event: MessageEvent<WebPlayInstallWorkerOutput>) => {
      const message = event.data;

      if (message.type === "install-measurement") {
        const start = analyticsInstallStarted.current;
        analyticsInstallStarted.current = null;
        if (start !== null) {
          const { outcome, download_unpack_ms, ...metrics } = message.measurement;
          const duration = Math.round(performance.now() - start);
          trackAnalytics("install_result", { ...metrics, duration_ms: duration,
            ...(download_unpack_ms === null ? {} : { download_unpack_ms }),
            install_outcome: outcome, duration_bucket: analyticsDurationBucket(duration),
            size_bucket: analyticsSizeBucket(metadata.installTotalSizeBytes),
            work_id: metadata.workId, archive_version_id: metadata.archiveVersionId });
        }
        return;
      }

      if (message.type === "install-finished") {
        installSessionRef.current = false;
        setInstallSessionActive(false);
        return;
      }
      if (message.type === "install-rejected") {
        installSessionRef.current = false;
        setInstallSessionActive(false);
        setOperationError(message.errorMessage ?? message.message);
        addLog("error", message.message, { errorMessage: message.errorMessage });
        return;
      }

      if (message.type === "installation") {
        setInstallation(message.installation);

        return;
      }

      if (message.type === "log") {
        const { errorMessage, reasonMessage } = message;
        addLog(message.level, message.message, { errorMessage, reasonMessage });
      }
    };
    workerRef.current = worker;

    return worker;
  }, [addLog, metadata]);

  const startInstall = useCallback(async () => {
    if (installSessionRef.current) return;
    installSessionRef.current = true;
    const signal = lifetimeRef.current!.signal;
    setOperationError(null);
    automaticInstallAttempts.current.add(metadata.playKey);

    analyticsInstallStarted.current = canTrackAnalytics() ? performance.now() : null;
    if (analyticsInstallStarted.current !== null) trackAnalytics("install_start", {
      work_id: metadata.workId, archive_version_id: metadata.archiveVersionId,
      size_bucket: analyticsSizeBucket(metadata.installTotalSizeBytes) });

    try {
      if (playerBusy) {
        throw new Error(t("play.diagnostic.installWhileRunning"));
      }

      setInstallSessionActive(true);
      setBrowserStorage(null);
      await cleanupExpiredGameResources().catch(error => {
        addLog("warning", formatFeedbackError(error, locale, t("play.diagnostic.partialCleanup")));
      });
      signal.throwIfAborted();
      const { protectionStatus, ...storageSnapshot } = await readBrowserStorage(true);
      signal.throwIfAborted();
      setBrowserStorage({ protectionStatus, ...storageSnapshot });
      if (protectionStatus === "queryFailed" || protectionStatus === "requestFailed") {
        addLog("warning", t("play.diagnostic.storageWarning", { status: t(`play.diagnostic.storage.${protectionStatus}`) }));
      }
      signal.throwIfAborted();
      if (!(await canManageGameResources())) {
        throw new Error(t("play.diagnostic.storageUnsupported"));
      }
      signal.throwIfAborted();
      const worker = ensureWorker();

      worker.postMessage({
        type: "install",
        metadata,
        storageKind: chooseGameStorage(),
        storageSnapshot,
        analyticsEnabled: analyticsInstallStarted.current !== null,
      } satisfies WebPlayInstallWorkerInput);
      addLog("info", t("play.install.logStart", { action: installAction }));
    } catch (error) {
      if (signal.aborted) return;
      const start = analyticsInstallStarted.current;
      analyticsInstallStarted.current = null;
      if (start !== null) trackAnalytics("install_result", {
        install_outcome: "error", duration_ms: Math.round(performance.now() - start),
        size_bucket: analyticsSizeBucket(metadata.installTotalSizeBytes),
        work_id: metadata.workId, archive_version_id: metadata.archiveVersionId });
      installSessionRef.current = false;
      setInstallSessionActive(false);
      const message = formatFeedbackError(error, locale, t("play.install.startFailed", { action: installAction }));
      setOperationError(message);
      addLog("error", message);
    }
  }, [addLog, ensureWorker, installAction, metadata, playerBusy, locale, t]);

  useEffect(() => {
    if (loadingLocalState || !hasPreviousInstallation || installed || installing || playerBusy || installSessionActive ||
        automaticInstallAttempts.current.has(metadata.playKey)) return;
    void startInstall();
  }, [hasPreviousInstallation, installed, installing, installSessionActive, loadingLocalState, metadata.playKey, playerBusy, startInstall]);

  const cancelInstall = useCallback(() => {
    workerRef.current?.postMessage({
      type: "cancel",
      playKey: metadata.playKey,
    } satisfies WebPlayInstallWorkerInput);
    addLog("warning", t("play.install.cancelRequested", { action: installAction }));
  }, [addLog, installAction, metadata.playKey, t]);

  const deleteLocalInstall = useCallback(async () => {
    setOperationError(null);

    try {
      if (playerBusy) {
        throw new Error(t("play.diagnostic.uninstallWhileRunning"));
      }

      if (!(await canManageGameResources())) {
        throw new Error(t("play.diagnostic.storageUnsupported"));
      }
      await deleteLocalGame(metadata.playKey);
      setInstallation(null);
      setBrowserStorage(await readBrowserStorage());
      addLog("info", t("play.diagnostic.uninstalled"));
    } catch (error) {
      const message =
        formatFeedbackError(error, locale, t("play.diagnostic.uninstallFailed"));
      setOperationError(message);
      addLog("error", message);
    }
  }, [addLog, metadata.playKey, playerBusy, locale, t]);

  const startPlayer = useCallback(async (): Promise<boolean> => {
    if (running) return true;
    if (startingRef.current) return false;
    const signal = lifetimeRef.current!.signal;
    setOperationError(null);

    let analyticsStarted: number | null = null;
    try {
      if (!installed) {
        throw new Error(t("play.diagnostic.needInstall"));
      }

      startingRef.current = true;
      setPlayerStarting(true);
      const latest = await checkForUpdate();
      signal.throwIfAborted();
      if (latest && latest.playKey !== metadata.playKey) return false;
      if (!playerHostRef.current) return false;
      analyticsStarted = canTrackAnalytics() ? performance.now() : null;
      if (analyticsStarted !== null) trackAnalytics("play_start", { work_id: metadata.workId,
        archive_version_id: metadata.archiveVersionId });
      const player = createPlayerSession(playerHostRef.current, latest ?? metadata, addLog, () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else setPageFullscreen(value => !value);
        focusPlayerCanvas();
      }, () => {
        playerRef.current = null;
        setRunning(false);
        setPageFullscreen(false);
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      }, image => { void captureRef.current(async () => image); }, locale);
      playerRef.current = player;
      await player.ready;
      signal.throwIfAborted();
      setRunning(true);
      focusPlayerCanvas();
      signal.throwIfAborted();
      reportWorkPlayed(metadata.workId);
      if (analyticsStarted !== null) trackAnalytics("play_result", { install_outcome: "success",
        duration_ms: Math.round(performance.now() - analyticsStarted), work_id: metadata.workId,
        archive_version_id: metadata.archiveVersionId });
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      if (analyticsStarted !== null) trackAnalytics("play_result", { install_outcome: "error",
        duration_ms: Math.round(performance.now() - analyticsStarted), work_id: metadata.workId,
        archive_version_id: metadata.archiveVersionId });
      playerRef.current?.dispose();
      playerRef.current = null;
      const message =
        formatFeedbackError(error, locale, t("play.diagnostic.launchFailed"));
      setOperationError(message);
      addLog("error", message);
      setRunning(false);
      await cleanupExpiredGameResources().catch(() => {});
      const current = await getWebPlayInstallation(metadata.playKey).catch(() => null);
      if (!signal.aborted) setInstallation(current);
      return false;
    } finally {
      startingRef.current = false;
      if (!signal.aborted) setPlayerStarting(false);
    }
  }, [addLog, checkForUpdate, installed, metadata, running, locale, t]);

  const lockOrientation = useCallback(
    async (next: DisplayOrientation): Promise<boolean> => {
      if (isAndroidClient()) {
        androidOrientationBridge()?.setOrientation(next);
        setOrientationLockActive(true);
        return true;
      }
      const orientation = screen.orientation as LockableScreenOrientation;
      if (typeof orientation?.lock !== "function") {
        setOrientationLockActive(false);
        return false;
      }

      try {
        await orientation.lock(next);
        setOrientationLockActive(true);
        return true;
      } catch {
        setOrientationLockActive(false);
        return false;
      }
    },
    [],
  );

  const enterImmersive = useCallback(
    async (next: DisplayOrientation): Promise<boolean> => {
      const frame = document.getElementById("web-player-frame");
      if (!frame) {
        setOperationError(t("play.diagnostic.missingCanvas"));
        return false;
      }

      setDisplayOrientation(next);

      if (document.fullscreenEnabled && frame.requestFullscreen) {
        try {
          await frame.requestFullscreen({ navigationUI: "hide" });
          if (mobileControls) await lockOrientation(next);
          focusPlayerCanvas();
          return true;
        } catch {
          addLog("warning", t("play.diagnostic.fullscreenFallback"));
        }
      }

      setPageFullscreen(true);
      if (mobileControls) await lockOrientation(next);
      focusPlayerCanvas();
      return true;
    },
    [addLog, lockOrientation, mobileControls, setDisplayOrientation, t],
  );

  const enterPageFullscreen = useCallback(() => {
    setPageFullscreen(true);
    focusPlayerCanvas();
  }, []);

  const exitImmersive = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setPageFullscreen(false);
    unlockScreenOrientation();
    setOrientationLockActive(false);
    focusPlayerCanvas();
  }, []);

  const stopPlayer = useCallback(async () => {
    if (startingRef.current || !playerRef.current) return;
    setPlayerStopping(true);
    try {
      await playerRef.current.dispose();
      playerRef.current = null;
      await exitImmersive();
      if (!lifetimeRef.current?.signal.aborted) setRunning(false);
      addLog("info", t("play.diagnostic.stopped"));
    } catch (error) {
      setOperationError(formatFeedbackError(error, locale, t("play.diagnostic.stopFailed")));
    } finally {
      if (!lifetimeRef.current?.signal.aborted) {
        setPlayerStopping(false);
      }
    }
  }, [addLog, exitImmersive, locale, t]);

  useEffect(() => {
    if (clientEnvironment !== "android") return;
    const onBack = () => { if (!playerStopping) void stopPlayer(); };
    window.addEventListener("viprpg:back", onBack);
    return () => window.removeEventListener("viprpg:back", onBack);
  }, [clientEnvironment, playerStopping, stopPlayer]);

  const startDefaultPlayer = useCallback(async () => {
    if (running || startingRef.current) return;
    // Request fullscreen during the tap so mobile browsers retain user activation.
    const fullscreenRequest = mobileControls ? enterImmersive(displayOrientation) : null;
    const started = await startPlayer();
    await fullscreenRequest;
    if (lifetimeRef.current?.signal.aborted) return;
    if (!started && mobileControls) await exitImmersive();
  }, [displayOrientation, enterImmersive, exitImmersive, mobileControls, running, startPlayer]);

  const changeDisplayOrientation = useCallback(
    async (next: DisplayOrientation) => {
      setDisplayOrientation(next);
      if (nativeFullscreen || isAndroidClient()) {
        await lockOrientation(next);
      } else {
        setOrientationLockActive(false);
      }
      focusPlayerCanvas();
    },
    [lockOrientation, nativeFullscreen, setDisplayOrientation],
  );

  const storageSummary = useMemo(() => {
    return [
      { label: t("play.diagnostic.local"), value: localStatusLabel },
      {
        label: t("play.diagnostic.protection"),
        info: t("play.diagnostic.protectionHelp"),
        value: t(`play.diagnostic.storage.${browserStorage?.protectionStatus ?? "checking"}`),
      },
      {
        label: t("play.diagnostic.usage"),
        value: browserStorage?.storageUsageBytes == null ? t("play.diagnostic.unknown") : formatBytes(browserStorage.storageUsageBytes),
      },
      {
        label: t("play.diagnostic.quota"),
        value: browserStorage?.storageQuotaBytes == null ? t("play.diagnostic.unknown") : formatBytes(browserStorage.storageQuotaBytes),
      },
    ];
  }, [localStatusLabel, browserStorage, t]);

  const rotation =
    immersive && mobileControls && !orientationLockActive
      ? displayOrientation === "landscape" && viewportPortrait
        ? 90
        : displayOrientation === "portrait" && !viewportPortrait
          ? -90
          : 0
      : 0;
  const surfaceOrientation = immersive ? displayOrientation : viewportPortrait ? "portrait" : "landscape";
  const nextOrientation = displayOrientation === "landscape" ? "portrait" : "landscape";

  return (
    <div
      data-web-play-status={
        loadingLocalState ? "loading" : (installation?.status ?? "deleted")
      }
    >
      <DetailPageLayout
        sidebarLabel={t("play.diagnostic.sidebar")}
        main={
          <>
            <section aria-labelledby="player-title" className="py-4.5">
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="player-title">
                  {t("play.install.surface")}
                </h2>
                <span className="font-mono text-xs text-muted">
                  {running ? t("play.install.running") : playerStarting ? t("play.install.starting") : installSessionActive ? t("play.install.inProgress", { action: installAction }) : t("play.install.idle")}
                </span>
              </div>
              <div className="aspect-4/3 w-full">
                <div
                  className={
                    pageFullscreen
                      ? "fixed inset-0 z-[100] h-[100dvh] w-screen overflow-hidden border-0 bg-black focus-within:ring-2 focus-within:ring-accent"
                      : "relative h-full w-full overflow-hidden rounded-lg border border-border bg-black focus-within:ring-2 focus-within:ring-accent"
                  }
                  id="web-player-frame"
                >
                  <WebPlaySurface
                    captureDisabled={captureDisabled}
                    immersive={immersive}
                    running={running}
                    layout={controlsPreferences.layouts[surfaceOrientation]}
                    mobile={mobileControls && running}
                    onCaptureScreenshot={() => void captureScreenshot()}
                    onSaveLayout={saveLayout}
                    onTouchEnabledChange={setTouchEnabled}
                    orientation={surfaceOrientation}
                    playerHostRef={playerHostRef}
                    playerRef={playerRef}
                    rotation={rotation}
                    touchEnabled={!mobileControls || controlsPreferences.touchEnabled}
                    placeholder={!running ? (
                      <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 p-6 text-center text-sm text-white/75">
                        {playerStarting
                          ? t("play.install.startingEngine")
                          : installSessionActive
                            ? t("play.install.processingFiles", { action: installAction })
                            : installed
                              ? t("play.install.ready")
                              : hasPreviousInstallation ? t("play.install.pendingUpdate") : t("play.install.status.deleted")}
                      </div>
                    ) : null}
                    toolbar={immersive ? (
                      <>
                        {mobileControls && running ? (
                          <Button
                            aria-label={t(nextOrientation === "landscape" ? "play.install.landscape" : "play.install.portrait")}
                            className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                            onClick={() => void changeDisplayOrientation(nextOrientation)}
                            size="icon"
                            title={t(nextOrientation === "landscape" ? "play.install.landscape" : "play.install.portrait")}
                            type="button"
                            variant="outline"
                          >
                            {nextOrientation === "landscape" ? <RectangleHorizontal aria-hidden /> : <RectangleVertical aria-hidden />}
                          </Button>
                        ) : null}
                        <Button
                          aria-label={t("play.install.windowed")}
                          className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                          onClick={() => void exitImmersive()}
                          size="icon"
                          title={t("play.install.windowed")}
                          type="button"
                          variant="outline"
                        >
                          <Minimize2 aria-hidden />
                        </Button>
                        {!mobileControls ? (
                          <Button
                            aria-label={t(capturing ? "play.install.capturing" : "play.install.capture")}
                            className="border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white"
                            disabled={captureDisabled}
                            onClick={() => void captureScreenshot()}
                            size="icon"
                            title={t("play.install.capture")}
                            type="button"
                            variant="outline"
                          >
                            <Camera aria-hidden />
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    feedback={null}
                  />
                </div>
              </div>
            </section>

            {comments}
          </>
        }
        sidebar={
          <WorkSidebar
            extras={clientEnvironment === "browser" ? <WebPlayScreenshotGallery onDelete={removeScreenshots} screenshots={screenshots} title={metadata.title} /> : null}
            mobilePrimaryFirst
            notice={notice}
            primary={
              <div className="grid gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="m-0 text-base font-bold">{t("work.play")}</h2>
                  <span className="font-mono text-xs text-muted">
                    {loadingLocalState
                      ? t("play.install.status.loading")
                      : localStatusLabel}
                  </span>
                </div>

                {interruptedInstalling ? (
                  <Notice
                    tone="error"
                    className="m-0 rounded-md border p-3 text-sm"
                  >
                    {t("play.install.interrupted", { action: installAction })}
                  </Notice>
                ) : null}
                {operationError ? (
                  <Notice
                    tone="error"
                    className="m-0 rounded-md border p-3 text-sm"
                    role="alert"
                  >
                    {typeof operationError === "string" ? operationError : t(operationError.key, operationError.values)}
                  </Notice>
                ) : null}

                {installSessionActive && installing && installation ? (
                  <InstallProgress action={installAction} installation={installation} />
                ) : null}

                {loadingLocalState ? (
                  <Button className="w-full" disabled type="button">
                    {t("play.install.loadingLocal")}
                  </Button>
                ) : installSessionActive ? (
                  <Button
                    className="w-full"
                    disabled={!installing}
                    onClick={cancelInstall}
                    type="button"
                    variant="outline"
                  >
                    {installing ? t("play.install.cancel", { action: installAction }) : t("play.install.working", { action: installAction })}
                  </Button>
                ) : failed || interruptedInstalling ? (
                  <Rm2kButton
                    className="w-full"
                    data-web-play-action="install"
                    onClick={startInstall}
                    type="button"
                  >
                    {t("play.install.retry", { action: installAction })}
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
                      {playerStarting ? t("play.install.launching") : t("play.install.startGame")}
                    </Rm2kButton>
                  ) : (
                    <div className={mobileControls ? "grid gap-2" : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2"}>
                      {!mobileControls ? (
                        <Button
                          className="min-w-0 gap-1.5 px-2"
                          disabled={playerStopping}
                          onClick={enterPageFullscreen}
                          type="button"
                          variant="outline"
                        >
                          <Maximize aria-hidden />
                          {t("play.install.fullscreenPage")}
                        </Button>
                      ) : null}
                      <Button
                        className="min-w-0 gap-1.5 px-2"
                        disabled={playerStopping}
                        onClick={() => void enterImmersive(displayOrientation)}
                        type="button"
                        variant="outline"
                      >
                        <Expand aria-hidden />
                        {t("play.install.fullscreenScreen")}
                      </Button>
                      {!mobileControls ? (
                        <Button
                          aria-label={t(capturing ? "play.install.capturing" : "play.install.capture")}
                          disabled={captureDisabled}
                          onClick={() => void captureScreenshot()}
                          size="icon"
                          title={t("play.install.capture")}
                          type="button"
                          variant="outline"
                        >
                          <Camera aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  )
                ) : (
                  <Rm2kButton
                    className="w-full"
                    data-web-play-action="install"
                    onClick={startInstall}
                    type="button"
                  >
                    {t("play.install.start", { action: installAction })} · {formatBytes(metadata.installTotalSizeBytes)}
                  </Rm2kButton>
                )}

                {engagement}

                <div className="relative">
                  <details
                    className="border-t border-border pt-3"
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      if (open && !installSessionActive) setBrowserStorage(null);
                      setDiagnosticsOpen(open);
                    }}
                  >
                    <summary className={desktopControlsHelp ? "cursor-pointer pr-28 text-sm font-semibold text-muted hover:text-foreground" : "cursor-pointer text-sm font-semibold text-muted hover:text-foreground"}>
                      {t("play.diagnostic.title")}
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <dl className="grid gap-2 text-xs">
                        <DiagnosticRow
                          label={t("play.diagnostic.archive")}
                          value={t("play.diagnostic.sizeFiles", { size: formatBytes(metadata.totalSizeBytes), count: metadata.totalFiles })}
                        />
                        <DiagnosticRow
                          label={t("play.install.content", { action: installAction })}
                          value={t("play.diagnostic.sizeFiles", { size: formatBytes(metadata.installTotalSizeBytes), count: metadata.installTotalFiles })}
                        />
                        {storageSummary?.map((item) => (
                          <DiagnosticRow
                            key={item.label}
                            label={item.label}
                            info={item.info}
                            value={item.value}
                          />
                        ))}
                      </dl>

                      {installation && !installSessionActive ? (
                        <InstallProgress action={installAction} installation={installation} compact />
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
                            {playerStopping ? t("play.diagnostic.stopping") : t("play.diagnostic.stop")}
                          </Button>
                        ) : null}
                        <WebPlaySaveExport key={metadata.workId} playKey={metadata.playKey} playerBusy={playerBusy} active={diagnosticsOpen} title={metadata.title} workId={metadata.workId} />
                        {installation ? (
                          <Button
                            aria-controls="uninstall-game-dialog"
                            aria-expanded={deleteDialogOpen}
                            aria-haspopup="dialog"
                            ref={deleteButtonRef}
                            disabled={playerBusy}
                            onClick={() => setDeleteDialogOpen(true)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {t("play.diagnostic.uninstall")}
                          </Button>
                        ) : null}
                      </div>

                      <div className="border-t border-border pt-3 font-mono text-xs">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <strong>{t("play.diagnostic.logs", { count: logs.length })}</strong>
                          {logs.length ? (
                            <div className="flex items-center gap-1">
                              <Button
                                disabled={copyingLogs}
                                onClick={() => void copyLogs()}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {copyingLogs ? t("play.diagnostic.copying") : t("play.diagnostic.copy")}
                              </Button>
                              <Button
                                disabled={copyingLogs}
                                onClick={() => {
                                  setLogs([]);
                                  pendingLogs.current = [];
                                }}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {t("play.diagnostic.clear")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {logs.length ? (
                          <ol className="m-0 grid max-h-64 list-none gap-1 overflow-y-auto p-0">
                            {logs.map((log) => (
                              <li
                                className={`${logTone(log.level)} whitespace-pre-wrap wrap-anywhere`}
                                key={log.id}
                              >
                                {formatLog(log, t)}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <EmptyState
                            title={t("play.diagnostic.emptyLogs")}
                            variant="plain"
                            className="text-xs"
                          />
                        )}
                      </div>
                    </div>
                  </details>
                  {desktopControlsHelp ? <WebPlayControlsHelp /> : null}
                </div>

                <InstallDiagnosticsPanel />

                <AlertDialog
                  onOpenChange={setDeleteDialogOpen}
                  open={deleteDialogOpen}
                >
                  <AlertDialogContent
                    id="uninstall-game-dialog"
                    onCloseAutoFocus={(event) => {
                      event.preventDefault();
                      deleteButtonRef.current?.focus();
                    }}
                  >
                    <AlertDialogTitle>{t("play.diagnostic.uninstallConfirm")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("play.diagnostic.uninstallDetails")}
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                      <AlertDialogCancel asChild>
                        <Button variant="outline">{t("play.save.cancel")}</Button>
                      </AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button
                          onClick={() => {
                            setDeleteDialogOpen(false);
                            void deleteLocalInstall();
                          }}
                          variant="destructive"
                        >
                          {t("play.diagnostic.uninstall")}
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
  action,
  installation,
  compact = false,
}: {
  action: "install" | "update";
  installation: WebPlayInstallation;
  compact?: boolean;
}) {
  const t = useMessages();
  const progressLabel = t("play.install.progress", { action });
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
        <span>{t("play.install.downloadProgress")}</span>
        <strong className="text-right font-medium">
          {formatBytes(installation.downloadedBytes)} /{" "}
          {formatBytes(installation.downloadBytesTotal)}
        </strong>
      </div>
      <Progress aria-label={t("play.install.downloadProgress")} value={downloadPercent} />
      <div className="flex items-center justify-between gap-3">
        <span>{progressLabel}</span>
        <strong className="text-right font-medium">
          {t("play.install.fileProgress", {
            done: installation.installedFiles,
            total: installation.totalFiles,
          })}
        </strong>
      </div>
      <Progress aria-label={progressLabel} value={extractPercent} />
      {installation.error ? (
        <Notice tone="error" className="m-0 rounded-md border p-3 text-sm">
          {installation.errorMessage ? t(installation.errorMessage.key, installation.errorMessage.values) : installation.error}
        </Notice>
      ) : null}
    </div>
  );
}

function DiagnosticRow({ label, value, info }: { label: string; value: ReactNode; info?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-border/70 border-b pb-2 last:border-b-0 last:pb-0">
      <dt className="flex items-center gap-1 text-muted">
        {label}
        {info ? <InfoTooltip>{info}</InfoTooltip> : null}
      </dt>
      <dd className="m-0 max-w-48 text-right text-foreground">{value}</dd>
    </div>
  );
}

function logTone(level: WebPlayLog["level"]): string {
  if (level === "error") return "text-red-700 dark:text-red-300";
  if (level === "warning") return "text-amber-700 dark:text-amber-300";
  return "text-muted";
}

function formatLog(log: WebPlayLog, t: ReturnType<typeof useMessages>): string {
  const time = parseTimestamp(log.createdAt).toLocaleTimeString("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const { errorMessage, reasonMessage } = log;
  const values = reasonMessage
    ? { ...errorMessage?.values, reason: t(reasonMessage.key, reasonMessage.values) }
    : errorMessage?.values;
  const message = errorMessage ? t(errorMessage.key, values).slice(0, 16_000) : log.message;
  return message.split(/\r?\n/).map((line) => `[${time}]${line}`).join("\n");
}

function unlockScreenOrientation(): void {
  if (isAndroidClient()) {
    androidOrientationBridge()?.setOrientation("portrait");
    return;
  }
  const orientation = screen.orientation as
    | LockableScreenOrientation
    | undefined;
  orientation?.unlock?.();
}

function androidOrientationBridge(): { setOrientation: (direction: string) => void } | undefined {
  return (window as Window & { VIPRPGAndroid?: { setOrientation: (direction: string) => void } }).VIPRPGAndroid;
}

function focusPlayerCanvas(): void {
  const canvas = document
    .querySelector<HTMLIFrameElement>("#web-player-host iframe")
    ?.contentDocument?.querySelector<HTMLCanvasElement>("#canvas");

  canvas?.focus({ preventScroll: true });
}

async function readBrowserStorage(requestPersistence = false): Promise<BrowserStorageStatus> {
  const storage = navigator.storage;

  if (!storage) {
    return {
      persistedStorage: null,
      storageQuotaBytes: null,
      storageUsageBytes: null,
      protectionStatus: "unsupported",
    };
  }

  let persistedStorage: boolean | null = null;
  let protectionStatus: BrowserStorageStatus["protectionStatus"] = "unsupported";

  if (typeof storage.persisted === "function") {
    try {
      persistedStorage = await storage.persisted();
      protectionStatus = persistedStorage ? "granted" : "denied";
    } catch {
      protectionStatus = "queryFailed";
    }
  }

  if (requestPersistence && persistedStorage !== true && typeof storage.persist === "function") {
    try {
      persistedStorage = await storage.persist();
      protectionStatus = persistedStorage ? "granted" : "denied";
    } catch {
      protectionStatus = "requestFailed";
    }
  }

  const estimate = await storage.estimate?.().catch(() => null);

  return {
    persistedStorage,
    protectionStatus,
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
