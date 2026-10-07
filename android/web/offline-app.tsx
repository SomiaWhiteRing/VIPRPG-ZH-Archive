import { localRequest } from "@/lib/browser/android-local";
import { Button } from "@/app/components/ui/button";
import { useWebPlayControlsPreferences } from "@/app/play/[workId]/web-play-controls-preferences";
import { createPlayerSession } from "@/app/play/[workId]/web-play-player";
import type { PlayerSession } from "@/app/play/[workId]/web-play-player";
import { useWebPlayScreenshots } from "@/app/play/[workId]/web-play-screenshots";
import { WebPlaySurface } from "@/app/play/[workId]/web-play-surface";
import type { WebPlayInstallation } from "@/app/play/[workId]/web-play-types";
import { easyRpgRuntimeBasePath } from "@/lib/archive/web-play";
import { ArrowLeft, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AndroidBridge = {
  requestPlayerFocus?: () => void;
  setPlaying: (playing: boolean) => void;
  setOrientation: (orientation: string) => void;
  setLibraryError?: (error: string) => void;
};

declare global {
  interface Window { VIPRPGAndroid?: AndroidBridge }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "本地数据读取失败。";
}

export function OfflineApp() {
  useEffect(() => {
    const markTouch = () => { document.documentElement.dataset.androidTouch = "true"; };
    const markKeyboard = () => { document.documentElement.dataset.androidTouch = "false"; };
    document.addEventListener("pointerdown", markTouch, true);
    document.addEventListener("keydown", markKeyboard, true);
    return () => {
      document.removeEventListener("pointerdown", markTouch, true);
      document.removeEventListener("keydown", markKeyboard, true);
      delete document.documentElement.dataset.androidTouch;
    };
  }, []);
  const [selected, setSelected] = useState<WebPlayInstallation | null>(null);
  const refresh = useCallback(async () => {
    try {
      const { items: rows } = await localRequest<{ items: WebPlayInstallation[] }>("list");
      const key = await localRequest<string | null>("pendingPlay");
      const item = rows.find(row => row.playKey === key);
      if (item?.status === "ready" && item.workId) setSelected(item);
    } catch (reason) {
      window.VIPRPGAndroid?.setLibraryError?.(message(reason));
    }
  }, []);
  const closeGame = useCallback(() => { setSelected(null); void refresh(); }, [refresh]);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    const onRefresh = () => { void refresh(); };
    const onPlay = () => { void refresh(); };
    window.addEventListener("viprpg:library-refresh", onRefresh);
    window.addEventListener("viprpg:library-play", onPlay);
    return () => {
      window.removeEventListener("viprpg:library-refresh", onRefresh);
      window.removeEventListener("viprpg:library-play", onPlay);
    };
  });

  // The APK's native library owns all browsing and selection UI.
  return selected ? <OfflineGame installation={selected} onClose={closeGame} /> : null;
}

function OfflineGame({ installation, onClose }: { installation: WebPlayInstallation; onClose: () => void }) {
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerSession | null>(null);
  const stoppingRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), feedback.ok ? 1000 : 12000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const [portrait, setPortrait] = useState(window.matchMedia("(orientation: portrait)").matches);
  const { preferences, loaded, setOrientation, setTouchEnabled, saveLayout } = useWebPlayControlsPreferences();
  const { capture, capturing } = useWebPlayScreenshots(installation.workId!, installation.title);
  const captureRef = useRef(capture);
  useEffect(() => { captureRef.current = capture; }, [capture]);
  const orientation = preferences.orientation;

  useEffect(() => {
    if (!loaded) return;
    window.VIPRPGAndroid?.setPlaying(true);
    return () => window.VIPRPGAndroid?.setPlaying(false);
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    window.VIPRPGAndroid?.setOrientation(orientation);
  }, [loaded, orientation]);

  const focusPlayer = useCallback(() => {
    if (document.hidden || !document.hasFocus() || stoppingRef.current) return;
    // Keep focus in the layout editor and any editable field when resuming.
    const active = document.activeElement;
    if (active?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    playerHostRef.current?.querySelector("iframe")?.contentDocument
      ?.querySelector<HTMLCanvasElement>("canvas")?.focus({ preventScroll: true });
    // The runtime observes the top-level page, including controls outside its iframe.
    window.dispatchEvent(new Event("focus"));
  }, []);

  useEffect(() => {
    const restore = () => { requestAnimationFrame(focusPlayer); };
    window.addEventListener("viprpg:player-focus", restore);
    return () => window.removeEventListener("viprpg:player-focus", restore);
  }, [focusPlayer]);

  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      await playerRef.current?.dispose();
      playerRef.current = null;
      onClose();
    } catch (reason) {
      setError(`存档尚未安全写入：${message(reason)}`);
      stoppingRef.current = false;
    }
  }, [onClose]);

  useEffect(() => {
    const query = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onBack = () => { void stop(); };
    window.addEventListener("viprpg:back", onBack);
    return () => window.removeEventListener("viprpg:back", onBack);
  }, [stop]);

  useEffect(() => {
    const host = playerHostRef.current;
    if (!loaded || !host) return;
    const session = createPlayerSession(host, {
      title: installation.title,
      workId: installation.workId!,
      archiveVersionId: installation.archiveVersionId,
      manifestSha256: installation.manifestSha256,
      engineFamily: installation.engineFamily!,
      easyRpg: installation.easyRpg,
      playKey: installation.playKey,
      runtimeBasePath: easyRpgRuntimeBasePath,
    }, () => {}, () => {}, () => { playerRef.current = null; onClose(); }, image => {
      void captureRef.current(async () => image).then(result => setFeedback(result ?? null));
    });
    playerRef.current = session;
    void session.ready.then(async () => {
      setStarting(false);
      if (window.VIPRPGAndroid?.requestPlayerFocus) window.VIPRPGAndroid.requestPlayerFocus();
      else focusPlayer();
    }).catch((reason) => { setStarting(false); setError(message(reason)); });
    return () => { void session.dispose(); };
  }, [loaded, installation, onClose, focusPlayer]);

  // Android owns physical rotation; CSS compensation is only for non-native previews.
  const rotation = window.VIPRPGAndroid ? 0 : orientation === "landscape" && portrait ? 90 : orientation === "portrait" && !portrait ? -90 : 0;
  const nextOrientation = orientation === "portrait" ? "landscape" : "portrait";
  if (!loaded) return null;
  return (
    <div className="offline-game" id="web-player-frame">
      <WebPlaySurface
        captureDisabled={starting || capturing}
        feedback={error || feedback ? <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 m-0 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 wrap-anywhere rounded bg-black/85 p-3 text-center text-sm text-white" role={error ? "alert" : "status"}>{error ?? feedback?.message}</p> : null}
        immersive
        layout={preferences.layouts[orientation]}
        mobile
        onCaptureScreenshot={() => {
          const player = playerRef.current;
          if (!player || starting || capturing || stoppingRef.current) return;
          void capture(() => player.captureScreenshot()).then(result => setFeedback(result ?? null));
        }}
        onSaveLayout={saveLayout}
        onTouchEnabledChange={setTouchEnabled}
        orientation={orientation}
        placeholder={starting ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white">正在启动 EasyRPG…</div> : null}
        playerHostRef={playerHostRef}
        playerRef={playerRef}
        rotation={rotation}
        toolbar={<>
          <Button aria-label="返回本地游戏" className="offline-toolbar-button" disabled={stoppingRef.current} onClick={() => void stop()} size="icon" title="返回本地游戏" type="button" variant="outline"><ArrowLeft aria-hidden /></Button>
          <Button aria-label={`切换为${nextOrientation === "portrait" ? "竖屏" : "横屏"}`} className="offline-toolbar-button" onClick={() => setOrientation(nextOrientation)} size="icon" title="切换方向" type="button" variant="outline">{nextOrientation === "portrait" ? <RectangleVertical aria-hidden /> : <RectangleHorizontal aria-hidden />}</Button>
        </>}
        touchEnabled={preferences.touchEnabled}
      />
    </div>
  );
}
