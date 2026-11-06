import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import * as Popover from "@/app/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { useToast } from "@/app/components/ui/toast";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { WorkCard } from "@/app/components/work/work-card";
import { WorkCardStat, WorkCardStats } from "@/app/components/work/work-popularity-stats";
import { busyGameResourceKeys, changeGameRetentionDays, cleanupExpiredGameResources, deleteLocalGame } from "@/app/play/[workId]/web-play-cleanup";
import { readGameRetentionDays, type GameRetentionDays } from "@/app/play/[workId]/web-play-retention";
import { subscribeGameResourcesChanged } from "@/app/play/[workId]/web-play-events";
import { rememberLocalLibraryWorks } from "@/app/play/[workId]/web-play-db";
import { requestJson } from "@/lib/ui/api-response";
import { formatBytes, formatDate, formatDateKey, parseTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { Check, ChevronDown, Clock3, HardDrive, Image, ListChecks, LoaderCircle, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MetaFunction } from "react-router";
import { GameDetails, type LibraryPanel } from "./game-details";
import { listLocalLibraryGames, type LocalLibraryGame } from "./local-game-data";
import { useLocalCover } from "./use-local-cover";
import "./library.css";

export const meta: MetaFunction = () => [
  ...pageMetaDescriptors({ title: "本地游戏库" }),
  { name: "robots", content: "noindex" },
];

export default function InstalledGamesPage() {
  const environment = useClientEnvironment();
  return <PageContainer>{environment === "browser" ? <LocalGameLibrary /> : <>
    <PageHeader compact title="本地游戏库" />
    {environment === "android" ? <Button asChild className="mt-6" variant="outline"><a href="/_android/index.html">打开离线游玩</a></Button>
      : <p className="py-12 text-sm text-muted" role="status">读取本地游戏…</p>}
  </>}</PageContainer>;
}

function LocalGameLibrary() {
  const confirm = useConfirm(), toast = useToast();
  const [games, setGames] = useState<LocalLibraryGame[]>([]);
  const [usage, setUsage] = useState<number | null>(null);
  const [retention, setRetention] = useState<GameRetentionDays>(7);
  const [savingRetention, setSavingRetention] = useState(false);
  const [activeKeys, setActiveKeys] = useState(new Set<string>());
  const [selected, setSelected] = useState(new Set<string>());
  const [managing, setManaging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ key: string; panel: LibraryPanel } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const storageTrigger = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(false), refreshing = useRef(false), refreshAgain = useRef(false), removing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) { refreshAgain.current = true; return; }
    refreshing.current = true;
    try {
      do {
        refreshAgain.current = false;
        let warning: string | null = null;
        try { await cleanupExpiredGameResources(); }
        catch (cause) { warning = errorMessage(cause); }
        const rows = await listLocalLibraryGames();
        const days = await readGameRetentionDays();
        const active = await busyGameResourceKeys();
        const estimate = await navigator.storage?.estimate().catch(() => null);
        if (!alive.current) return;
        setGames(rows); setActiveKeys(active); setUsage(estimate?.usage ?? null); setRetention(days);
        setSelected(current => new Set([...current].filter(key => rows.some(row => row.key === key && row.installations.length && !row.installations.some(item => active.has(item.playKey))))));
        if (!removing.current) setError(warning);
        setLoading(false);
        const unknown = rows.filter(row => row.needsMetadata).flatMap(row => row.workId ? [row.workId] : []);
        if (unknown.length) {
          try {
            const works: Array<{ workId: number; title: string; coverBlobSha256: string | null }> = [];
            for (let offset = 0; offset < unknown.length; offset += 100) {
              const result = await requestJson<{ works: typeof works }>(`/api/works/local-library?ids=${unknown.slice(offset, offset + 100).join(",")}`, { signal: AbortSignal.timeout(8000) });
              works.push(...result.works);
            }
            await rememberLocalLibraryWorks(works);
            if (alive.current) setGames(current => current.map(game => {
              const metadata = works.find(work => work.workId === game.workId);
              return metadata ? { ...game, title: metadata.title, coverBlobSha256: metadata.coverBlobSha256, needsMetadata: false } : game;
            }));
          } catch (cause) { console.error("Local library metadata lookup failed", cause); }
        }
      } while (refreshAgain.current && alive.current);
    } catch (cause) {
      if (alive.current) { setError(errorMessage(cause)); setLoading(false); }
    } finally { refreshing.current = false; }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onVisible = () => { if (!document.hidden) void refresh(); };
    const unsubscribe = subscribeGameResourcesChanged(onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => { alive.current = false; unsubscribe(); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); };
  }, [refresh]);

  const removable = games.filter(game => game.installations.length && !game.installations.some(row => activeKeys.has(row.playKey)));
  const selectedGames = removable.filter(game => selected.has(game.key));
  const installations = games.flatMap(game => game.installations);
  const selectedGame = games.find(game => game.key === selection?.key);
  const groups = new Map<string, { label: string; games: LocalLibraryGame[] }>();
  const today = formatDateKey(new Date()), yesterday = formatDateKey(new Date(Date.now() - 86_400_000));
  for (const game of games) {
    const key = game.lastPlayedAt ? formatDateKey(parseTimestamp(game.lastPlayedAt)) : "unplayed";
    if (!groups.has(key)) groups.set(key, { label: key === today ? "今天" : key === yesterday ? "昨天" : key === "unplayed" ? "更久以前" : formatDate(game.lastPlayedAt, { time: false }), games: [] });
    groups.get(key)!.games.push(game);
  }

  async function remove(items: LocalLibraryGame[]) {
    if (removing.current || !items.length) return;
    const rows = items.flatMap(game => game.installations);
    const bytes = rows.reduce((sum, row) => sum + row.installedBytes, 0);
    if (!await confirm(`释放约 ${formatBytes(bytes)}，保留存档和截图。再次游玩需重新下载。`, {
      title: items.length === 1 ? `清理「${items[0].title}」？` : `清理 ${items.length} 项游戏？`, confirmLabel: "清理", destructive: true,
    })) return;
    removing.current = true; setBusy(true); setError(null);
    const failed: string[] = []; let released = 0;
    try {
      for (const row of rows) {
        try { await deleteLocalGame(row.playKey); released += row.installedBytes; }
        catch (cause) { failed.push(`${row.title}：${errorMessage(cause)}`); }
      }
      await refresh();
      if (!alive.current) return;
      setSelected(new Set());
      if (released) toast.success(`已清理约 ${formatBytes(released)}`);
      if (failed.length) setError(failed.join("\n"));
    } finally { removing.current = false; if (alive.current) setBusy(false); }
  }

  function open(game: LocalLibraryGame, panel: LibraryPanel, element: HTMLButtonElement) {
    trigger.current = element;
    setSelection({ key: game.key, panel });
  }

  return <div className="local-library-page">
    <PageHeader compact title="本地游戏库"
      subtitle={!loading ? <span>{games.length} 款游戏<span className="max-[480px]:sr-only"><span className="mx-2 text-border">/</span>{games.filter(game => game.installations.some(row => row.status === "ready")).length} 款已安装</span></span> : undefined}
      actions={<div className="flex items-center gap-2">
        {managing ? <>
          <Label className="flex min-h-9 shrink-0 items-center gap-2 text-xs"><Checkbox aria-label="全选可清理的游戏" disabled={busy || !removable.length}
            checked={removable.length > 0 && selectedGames.length === removable.length ? true : selectedGames.length ? "indeterminate" : false}
            onCheckedChange={checked => setSelected(checked === true ? new Set(removable.map(game => game.key)) : new Set())} /><span className="max-[480px]:sr-only">全选</span><span className="tabular-nums text-muted" aria-label={`已选 ${selectedGames.length} 项`}>{selectedGames.length}</span></Label>
          <Button className="max-[480px]:size-9 max-[480px]:p-0" disabled={busy || !selectedGames.length} onClick={() => void remove(selectedGames)} size="sm" type="button" variant="destructive">{busy ? <LoaderCircle aria-hidden className="animate-spin min-[481px]:hidden" /> : <Trash2 aria-hidden className="min-[481px]:hidden" />}<span className="max-[480px]:sr-only">{busy ? "正在清理…" : "清理所选"}</span></Button>
        </> : null}
        <Button className="max-[480px]:size-9 max-[480px]:p-0" disabled={busy || savingRetention || (!managing && !removable.length)} onClick={() => { setManaging(value => !value); setSelected(new Set()); }} size="sm" type="button" variant={managing ? "neutral" : "outline"}>{managing ? <Check aria-hidden /> : <ListChecks aria-hidden />}<span className="max-[480px]:sr-only">{managing ? "完成" : "批量管理"}</span></Button>
        {!managing ? <Popover.Root>
          <Popover.Trigger asChild><Button ref={storageTrigger} className="max-[480px]:size-9 max-[480px]:p-0" type="button" variant="ghost" size="sm"><HardDrive aria-hidden /><span className="max-[480px]:sr-only">存储</span><ChevronDown aria-hidden className="max-[480px]:hidden" /></Button></Popover.Trigger>
          <Popover.Portal anchorRef={storageTrigger}>
            <Popover.Content align="end" sideOffset={8} collisionPadding={16} aria-label="存储设置" className="z-50 max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-4 text-card-foreground shadow-surface">
              <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
                <dt className="text-muted">本站占用</dt><dd className="font-mono tabular-nums">{usage === null ? "—" : formatBytes(usage)}</dd>
                <dt className="text-muted">游戏文件</dt><dd className="font-mono tabular-nums">{loading ? "—" : formatBytes(installations.reduce((sum, row) => sum + row.installedBytes, 0))}</dd>
              </dl>
              <div className="mt-4 border-t border-border pt-3">
                <span className="mb-2 block text-xs font-medium text-muted">闲置清理</span>
                <RadioGroup aria-label="游戏文件自动清理周期" orientation="horizontal" className="flex gap-1" value={String(retention)} disabled={loading || busy || savingRetention} onValueChange={async value => {
                  const days = value === "never" ? "never" : Number(value);
                  if (days !== 7 && days !== 30 && days !== "never") return;
                  setSavingRetention(true); setError(null);
                  try { await changeGameRetentionDays(days); setRetention(days); await refresh(); }
                  catch (cause) { setError(errorMessage(cause)); }
                  finally { setSavingRetention(false); }
                }}>
                  {([{ value: 7, label: "7 天" }, { value: 30, label: "30 天" }, { value: "never", label: "永不" }] as const).map(option => <Label key={option.value} className="local-library-retention-option" data-selected={retention === option.value}>
                    <RadioGroupItem value={String(option.value)} aria-label={option.label} /><span>{option.label}</span>
                  </Label>)}
                </RadioGroup>
              </div>
              <div className="mt-4 border-t border-border pt-2"><Popover.Close asChild><Button className="w-full justify-start" disabled={busy || savingRetention || !removable.length} onClick={() => void remove(removable)} size="sm" type="button" variant="ghost">清理全部游戏文件</Button></Popover.Close></div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root> : null}
      </div>} />
    {error ? <Notice className="mb-5 whitespace-pre-wrap">{error}</Notice> : null}
    {loading ? <p className="py-12 text-sm text-muted" role="status">读取本地游戏…</p> : !games.length ? <EmptyState className="py-16 text-center" title="暂无本地游戏" variant="plain" />
      : [...groups].map(([key, group]) => <section className="local-library-game-group" key={key} aria-label={group.label}>
        <div className="local-library-group-heading"><h2 className="text-sm font-semibold">{group.label}</h2><span className="font-mono text-xs text-muted">{group.games.length}</span></div>
        <div className="local-library-game-grid grid grid-cols-2 gap-4 min-[641px]:grid-cols-3 min-[981px]:grid-cols-4 min-[1200px]:grid-cols-5">
          {group.games.map(game => <LibraryCard key={game.key} game={game} managing={managing} selected={selected.has(game.key)}
            disabled={busy || !game.installations.length || game.installations.some(row => activeKeys.has(row.playKey))}
            onSelect={checked => setSelected(current => { const next = new Set(current); if (checked) next.add(game.key); else next.delete(game.key); return next; })}
            onOpen={(panel, element) => open(game, panel, element)} />)}
        </div>
      </section>)}
    {selectedGame?.workId && selection ? <GameDetails key={`${selectedGame.key}:${selection.panel}`} game={selectedGame} workId={selectedGame.workId}
      initialPanel={selection.panel} active={selectedGame.installations.some(row => activeKeys.has(row.playKey))} trigger={trigger.current}
      onClose={() => setSelection(null)} onChanged={() => void refresh()} onClean={() => void remove([selectedGame])} /> : null}
  </div>;
}

function LibraryCard({ game, managing, selected, disabled, onSelect, onOpen }: {
  game: LocalLibraryGame; managing: boolean; selected: boolean; disabled: boolean;
  onSelect: (checked: boolean) => void; onOpen: (panel: LibraryPanel, element: HTMLButtonElement) => void;
}) {
  const cover = useLocalCover(game.coverBlobSha256);
  return <WorkCard title={game.title} coverSrc={cover} disabled={managing ? disabled : !game.workId}
    label={managing ? `选择 ${game.title}` : `打开 ${game.title} 的本地详情`}
    onOpen={event => { if (managing) onSelect(!selected); else onOpen("overview", event.currentTarget); }}
    action={managing ? <Label className="p-2"><Checkbox className="bg-transparent shadow-none" checked={selected} disabled={disabled} aria-label={`选择 ${game.title}`} onCheckedChange={checked => onSelect(checked === true)} /></Label> : undefined}
    imageActions={!managing ? <WorkCardStats label={`${game.title} 的本地资料`}>
      <WorkCardStat Icon={Save} label={`${game.title}，存档`} count={game.saveNames.length} disabled={!game.workId} onClick={event => onOpen("saves", event.currentTarget)} />
      <WorkCardStat Icon={Image} label={`${game.title}，截图`} count={game.screenshotCount} disabled={!game.workId} onClick={event => onOpen("screenshots", event.currentTarget)} />
    </WorkCardStats> : undefined}>
    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted"><Clock3 aria-hidden className="size-3.5" />{formatDate(game.lastPlayedAt, { time: true }) || "—"}</p>
  </WorkCard>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "无法读取本地游戏，请重试。";
}
