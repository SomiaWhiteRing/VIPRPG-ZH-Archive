import { Button } from "@/app/components/ui/button";
import {
  deleteWebPlayInstallation,
  getWebPlayInstallation,
  listWebPlayInstallations,
  saveWebPlayInstallation,
} from "@/app/play/[archiveVersionId]/web-play-db";
import { useWebPlayControlsPreferences } from "@/app/play/[archiveVersionId]/web-play-controls-preferences";
import { cacheWebPlayCover, deleteUnusedWebPlayCovers } from "@/app/play/[archiveVersionId]/web-play-cover";
import { withGameResourceWriteLock } from "@/app/play/[archiveVersionId]/web-play-locks";
import { resetGameOpfsDirectory } from "@/app/play/[archiveVersionId]/web-play-opfs";
import { createPlayerSession } from "@/app/play/[archiveVersionId]/web-play-player";
import type { PlayerSession } from "@/app/play/[archiveVersionId]/web-play-player";
import { useWebPlayScreenshots } from "@/app/play/[archiveVersionId]/web-play-screenshots";
import { WebPlaySurface } from "@/app/play/[archiveVersionId]/web-play-surface";
import type { WebPlayInstallation } from "@/app/play/[archiveVersionId]/web-play-types";
import { easyRpgRuntimeBasePath } from "@/lib/archive/web-play";
import { ArrowLeft, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AndroidBridge = {
  requestPlayerFocus?: () => void;
  setPlaying: (playing: boolean) => void;
  setOrientation: (orientation: string) => void;
  setLibrarySnapshot?: (snapshot: string) => void;
  setLibraryCover?: (playKey: string, image: string) => void;
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
  const [installations, setInstallations] = useState<WebPlayInstallation[]>([]);
  const [selected, setSelected] = useState<WebPlayInstallation | null>(null);
  const refresh = useCallback(async () => {
    try {
      const rows = await listWebPlayInstallations();
      setInstallations(rows);
      const used = (await navigator.storage.estimate())?.usage ?? null;
      window.VIPRPGAndroid?.setLibrarySnapshot?.(JSON.stringify({ items: rows, usage: used }));
      void publishNativeCovers(rows);
      if (navigator.onLine) void hydrateMissingCovers(rows, setInstallations);
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

  const remove = async (playKeys: string[]) => {
    const removed: WebPlayInstallation[] = [];
    try {
      for (const playKey of playKeys) {
        const installation = installations.find((item) => item.playKey === playKey);
        if (!installation) continue;
        await withGameResourceWriteLock(playKey, async () => {
          await resetGameOpfsDirectory(installation);
          await deleteWebPlayInstallation(playKey);
        });
        removed.push(installation);
      }
      await refresh();
    } catch (reason) {
      await refresh();
      window.VIPRPGAndroid?.setLibraryError?.(message(reason));
    } finally {
      if (removed.length) {
        const retained = installations.filter((item) => !removed.some((row) => row.playKey === item.playKey));
        void deleteUnusedWebPlayCovers(removed.map((item) => item.coverBlobSha256), retained.map((item) => item.coverBlobSha256)).catch(() => {});
      }
    }
  };

  useEffect(() => {
    const onRefresh = () => { void refresh(); };
    const onPlay = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const item = installations.find((row) => row.playKey === key);
      if (item?.status === "ready" && item.workId) setSelected(item);
    };
    const onDelete = (event: Event) => { void remove((event as CustomEvent<string[]>).detail); };
    window.addEventListener("viprpg:library-refresh", onRefresh);
    window.addEventListener("viprpg:library-play", onPlay);
    window.addEventListener("viprpg:library-delete", onDelete);
    return () => {
      window.removeEventListener("viprpg:library-refresh", onRefresh);
      window.removeEventListener("viprpg:library-play", onPlay);
      window.removeEventListener("viprpg:library-delete", onDelete);
    };
  });

  // The APK's native library owns all browsing and selection UI.
  return selected ? <OfflineGame installation={selected} onClose={closeGame} /> : null;
}

async function publishNativeCovers(installations: WebPlayInstallation[]) {
  if (!window.VIPRPGAndroid?.setLibraryCover) return;
  for (const installation of installations) {
    if (!installation.coverBlobSha256) continue;
    try {
      const blob = await cacheWebPlayCover(installation.coverBlobSha256);
      const image = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      // Keep the original aspect ratio before handing the thumbnail to Android.
      const scale = Math.min(192 / image.width, 240 / image.height, 1);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) { image.close(); continue; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      window.VIPRPGAndroid?.setLibraryCover?.(installation.playKey, canvas.toDataURL("image/jpeg", 0.8));
    } catch {
      // A missing cover must not prevent the native library from opening offline.
    }
  }
}

async function hydrateMissingCovers(
  installations: WebPlayInstallation[],
  update: React.Dispatch<React.SetStateAction<WebPlayInstallation[]>>,
) {
  for (const installation of installations) {
    if (installation.coverBlobSha256 || installation.status !== "ready") continue;
    try {
      const response = await fetch(`/api/archive-versions/${installation.archiveVersionId}/web-play`, {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const metadata = await response.json() as { playKey?: string; coverBlobSha256?: string | null };
      const cover = metadata.coverBlobSha256;
      if (metadata.playKey !== installation.playKey || !cover || !/^[a-f0-9]{64}$/i.test(cover)) continue;
      await cacheWebPlayCover(cover);
      await withGameResourceWriteLock(installation.playKey, async () => {
        const current = await getWebPlayInstallation(installation.playKey);
        if (!current || current.status !== "ready" || current.coverBlobSha256) return;
        const next = { ...current, coverBlobSha256: cover };
        await saveWebPlayInstallation(next);
        update((rows) => rows.map((row) => row.playKey === next.playKey ? next : row));
        if (window.VIPRPGAndroid?.setLibrarySnapshot) {
          const rows = await listWebPlayInstallations();
          const usage = (await navigator.storage.estimate()).usage ?? null;
          window.VIPRPGAndroid.setLibrarySnapshot(JSON.stringify({ items: rows, usage }));
          void publishNativeCovers(rows);
        }
      });
    } catch {
      // The local library remains usable even when the site is offline.
    }
  }
}

function OfflineGame({ installation, onClose }: { installation: WebPlayInstallation; onClose: () => void }) {
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerSession | null>(null);
  const stoppingRef = useRef(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [portrait, setPortrait] = useState(window.matchMedia("(orientation: portrait)").matches);
  const { preferences, loaded, setOrientation, setTouchEnabled, saveLayout } = useWebPlayControlsPreferences();
  const { capture, capturing } = useWebPlayScreenshots(installation.workId!, installation.title);
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
      playKey: installation.playKey,
      runtimeBasePath: easyRpgRuntimeBasePath,
    }, (level, text) => {
      if (level === "error") setError(text);
    }, () => {}, () => { playerRef.current = null; onClose(); });
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
        feedback={error || feedback ? <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 m-0 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 rounded bg-black/85 p-3 text-center text-sm text-white" role={error ? "alert" : "status"}>{error ?? feedback}</p> : null}
        immersive
        layout={preferences.layouts[orientation]}
        mobile
        onCaptureScreenshot={() => { void capture(playerRef.current).then((result) => setFeedback(result?.message ?? null)); }}
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
