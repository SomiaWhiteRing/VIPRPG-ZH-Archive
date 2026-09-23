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
import { formatBytes } from "@/lib/format";
import { ArrowLeft, CheckSquare2, Gamepad2, HardDrive, Play, RectangleHorizontal, RectangleVertical, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AndroidBridge = {
  setPlaying: (playing: boolean) => void;
  setOrientation: (orientation: string) => void;
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
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [managing, setManaging] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "incomplete">("all");
  const [sort, setSort] = useState<"recent" | "title" | "size">("recent");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listWebPlayInstallations();
      setInstallations(rows);
      setUsage((await navigator.storage.estimate())?.usage ?? null);
      setError(null);
      if (navigator.onLine) void hydrateMissingCovers(rows, setInstallations);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
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
    setBusy(true);
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
      setMarked((current) => current.filter((key) => !playKeys.includes(key)));
      setDeleting(null);
      await refresh();
    } catch (reason) {
      setMarked((current) => current.filter((key) => !removed.some((item) => item.playKey === key)));
      setDeleting(null);
      await refresh();
      setError(message(reason));
    } finally {
      if (removed.length) {
        const retained = installations.filter((item) => !removed.some((row) => row.playKey === item.playKey));
        void deleteUnusedWebPlayCovers(removed.map((item) => item.coverBlobSha256), retained.map((item) => item.coverBlobSha256)).catch(() => {});
      }
      setBusy(false);
    }
  };

  const ready = installations.filter((item) => item.status === "ready");
  const visible = installations.filter((item) =>
    (filter === "all" || (filter === "ready" ? item.status === "ready" : item.status !== "ready")) &&
    item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "size"
    ? b.installedBytes - a.installedBytes
    : (b.lastPlayedAt ?? b.readyAt ?? b.updatedAt).localeCompare(a.lastPlayedAt ?? a.readyAt ?? a.updatedAt));
  const visibleKeys = visible.map((item) => item.playKey);
  const allVisibleMarked = visible.length > 0 && visibleKeys.every((key) => marked.includes(key));
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 pb-8 pt-5">
        <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <img alt="" className="size-11 shrink-0 object-contain" src="/_android/icon.png" />
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold text-primary">VIPRPG.org</p>
              <h1 className="m-0 text-xl font-bold">本地游戏</h1>
            </div>
          </div>
          <Button aria-label="刷新游戏库" onClick={() => void refresh()} size="icon" title="刷新游戏库" type="button" variant="ghost"><RefreshCw aria-hidden /></Button>
        </header>
        <div className="flex items-center gap-2 py-3 text-xs text-muted">
          <HardDrive aria-hidden className="size-4" />
          <span>{ready.length} 款已安装{usage === null ? "" : ` · 本站已用 ${formatBytes(usage)}`}</span>
        </div>
        <div className="flex gap-2">
          <label className="offline-search flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-primary">
            <Search aria-hidden className="size-4 shrink-0 text-muted" />
            <input aria-label="搜索本地游戏" className="h-10 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品" type="search" value={search} />
          </label>
          <Button aria-label={managing ? "完成管理" : "批量管理"} aria-pressed={managing} onClick={() => { setManaging(!managing); setMarked([]); }} size="icon" title={managing ? "完成管理" : "批量管理"} type="button" variant={managing ? "default" : "outline"}>{managing ? <X aria-hidden /> : <CheckSquare2 aria-hidden />}</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3">
          <div aria-label="安装状态" className="inline-flex rounded-md border border-border p-0.5 text-sm" role="group">
            {([ ["all", "全部"], ["ready", "已安装"], ["incomplete", "未完成"] ] as const).map(([value, label]) => (
              <button aria-pressed={filter === value} className={`min-h-9 rounded px-3 ${filter === value ? "bg-primary text-white" : "text-muted"}`} key={value} onClick={() => setFilter(value)} type="button">{label}</button>
            ))}
          </div>
          <label className="text-xs text-muted">排序 <select className="min-h-9 rounded border border-border bg-card px-2 text-sm text-foreground" onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}><option value="recent">最近游玩</option><option value="title">名称</option><option value="size">大小</option></select></label>
        </div>
        {managing ? (
          <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm">
            <label className="flex items-center gap-2"><input checked={allVisibleMarked} disabled={busy || !visible.length} onChange={() => setMarked(allVisibleMarked ? marked.filter((key) => !visibleKeys.includes(key)) : [...new Set([...marked, ...visibleKeys])])} type="checkbox" />全选当前结果</label>
            <Button disabled={busy || !marked.length} onClick={() => setDeleting(marked)} size="sm" type="button" variant="destructive"><Trash2 aria-hidden className="size-4" />删除 {marked.length} 项</Button>
          </div>
        ) : null}
        {error ? <p className="my-3 border-l-4 border-destructive bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
        {loading ? <p className="py-12 text-center text-muted">读取本地游戏…</p> : null}
        {!loading && installations.length === 0 ? (
          <div className="grid justify-items-center gap-3 py-16 text-center text-muted">
            <Gamepad2 aria-hidden className="size-12 text-primary" />
            <p className="m-0 font-semibold text-foreground">还没有本地作品</p>
            <p className="m-0 text-sm">联网后在在线游玩页安装，游戏会自动出现在这里。</p>
          </div>
        ) : null}
        {!loading && installations.length > 0 && !visible.length ? <p className="py-12 text-center text-sm text-muted">没有符合条件的作品</p> : null}
        {visible.length > 0 ? (
          <ul className="m-0 divide-y divide-border p-0" aria-label="本地作品">
            {visible.map((item) => (
              <li className="flex min-h-24 items-center gap-3 py-3" key={item.playKey}>
                {managing ? <input aria-label={`选择 ${item.title}`} checked={marked.includes(item.playKey)} disabled={busy} onChange={() => setMarked((current) => current.includes(item.playKey) ? current.filter((key) => key !== item.playKey) : [...current, item.playKey])} type="checkbox" /> : null}
                <Cover installation={item} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate font-semibold">{item.title}</p>
                  <p className="m-0 mt-1 text-xs text-muted">{item.status === "ready" ? formatBytes(item.installedBytes) : "未完成安装"}{item.lastPlayedAt ? ` · ${new Date(item.lastPlayedAt).toLocaleDateString("zh-CN")}` : ""}</p>
                </div>
                {!managing && item.status === "ready" ? <Button aria-label={`游玩 ${item.title}`} disabled={!item.workId} onClick={() => setSelected(item)} size="icon" title="离线游玩" type="button"><Play aria-hidden /></Button> : null}
                {!managing && item.status !== "ready" ? <a className="shrink-0 text-sm text-primary underline" href={`/play/${item.archiveVersionId}`}>重新安装</a> : null}
                {!managing ? <Button aria-label={`删除 ${item.title}`} onClick={() => setDeleting([item.playKey])} size="icon" title="删除本地游戏" type="button" variant="ghost"><Trash2 aria-hidden /></Button> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </main>
      {deleting ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-5" role="presentation">
          <div aria-describedby="delete-description" aria-labelledby="delete-title" aria-modal="true" className="w-full max-w-sm rounded-md bg-card p-5 shadow-lg" role="dialog">
            <h2 className="m-0 text-lg font-bold" id="delete-title">删除 {deleting.length} 项本地作品？</h2>
            <p className="my-4 text-sm text-muted" id="delete-description">删除已安装的游戏文件；存档和截图不会删除。</p>
            <div className="flex justify-end gap-2">
              <Button disabled={busy} onClick={() => setDeleting(null)} type="button" variant="outline">取消</Button>
              <Button disabled={busy} onClick={() => void remove(deleting)} type="button" variant="destructive">{busy ? "正在删除…" : "删除"}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {selected ? <OfflineGame installation={selected} onClose={closeGame} /> : null}
    </>
  );
}

function Cover({ installation }: { installation: WebPlayInstallation }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (installation.coverBlobSha256) {
      void cacheWebPlayCover(installation.coverBlobSha256).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => {});
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [installation.coverBlobSha256]);
  return <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded bg-primary/10 text-xl font-semibold text-primary">{url ? <img alt="" className="h-full w-full object-cover" src={url} /> : installation.title.slice(0, 1)}</div>;
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
  const { preferences, setOrientation, setTouchEnabled, saveLayout } = useWebPlayControlsPreferences();
  const { capture, capturing } = useWebPlayScreenshots(installation.workId!);
  const orientation = preferences.orientation;

  useEffect(() => {
    window.VIPRPGAndroid?.setPlaying(true);
    return () => window.VIPRPGAndroid?.setPlaying(false);
  }, []);

  useEffect(() => {
    window.VIPRPGAndroid?.setOrientation(orientation);
  }, [orientation]);

  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      await playerRef.current?.dispose();
      playerRef.current = null;
      window.VIPRPGAndroid?.setOrientation("portrait");
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
    if (!host) return;
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
      host.querySelector("iframe")?.contentDocument?.querySelector("canvas")?.focus();
    }).catch((reason) => { setStarting(false); setError(message(reason)); });
    return () => { void session.dispose(); };
  }, [installation, onClose]);

  const rotation = orientation === "landscape" && portrait ? 90 : orientation === "portrait" && !portrait ? -90 : 0;
  const nextOrientation = orientation === "portrait" ? "landscape" : "portrait";
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
          <Button aria-label={`切换为${nextOrientation === "portrait" ? "竖屏" : "横屏"}`} className="offline-toolbar-button" onClick={() => { setOrientation(nextOrientation); window.VIPRPGAndroid?.setOrientation(nextOrientation); }} size="icon" title="切换方向" type="button" variant="outline">{nextOrientation === "portrait" ? <RectangleVertical aria-hidden /> : <RectangleHorizontal aria-hidden />}</Button>
        </>}
        touchEnabled={preferences.touchEnabled}
      />
    </div>
  );
}
