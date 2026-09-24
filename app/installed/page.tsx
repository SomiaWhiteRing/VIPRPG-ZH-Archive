import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { WorkListRow } from "@/app/components/work/work-list-row";
import { busyGameResourceKeys, cleanupExpiredGameResources, deleteLocalGame } from "@/app/play/[archiveVersionId]/web-play-cleanup";
import { readCachedWebPlayCover } from "@/app/play/[archiveVersionId]/web-play-cover";
import { listWebPlayInstallations } from "@/app/play/[archiveVersionId]/web-play-db";
import { subscribeGameResourcesChanged } from "@/app/play/[archiveVersionId]/web-play-events";
import { gameResourceExpiresAt, supportsGameBuckets } from "@/app/play/[archiveVersionId]/web-play-storage";
import type { WebPlayInstallation } from "@/app/play/[archiveVersionId]/web-play-types";
import { formatBytes } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { Check, Clock3, HardDrive, ListChecks, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  ...pageMetaDescriptors({ title: "已安装游戏" }),
  { name: "robots", content: "noindex" },
];

export default function InstalledGamesPage() {
  const environment = useClientEnvironment();
  if (environment === "browser") return <InstalledGames />;
  return (
    <PageContainer>
      <PageHeader compact title="已安装游戏" />
      {environment === "android" ? (
        <Button asChild className="mt-6" variant="outline"><a href="/_android/index.html">打开离线游玩</a></Button>
      ) : <p className="py-12 text-sm text-muted" role="status">读取本地游戏…</p>}
    </PageContainer>
  );
}

function InstalledGames() {
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<WebPlayInstallation[]>([]);
  const [usage, setUsage] = useState<number | null>(null);
  const [activeKeys, setActiveKeys] = useState(new Set<string>());
  const [selected, setSelected] = useState(new Set<string>());
  const [managing, setManaging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const removing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) { refreshAgain.current = true; return; }
    refreshing.current = true;
    try {
      do {
        refreshAgain.current = false;
        let warning: string | null = null;
        try { await cleanupExpiredGameResources(); }
        catch (cause) { warning = errorMessage(cause); }
        const installations = await listWebPlayInstallations();
        const active = await busyGameResourceKeys();
        const estimate = await navigator.storage?.estimate().catch(() => null);
        if (!alive.current) return;
        setRows(installations);
        setActiveKeys(active);
        setUsage(estimate?.usage ?? null);
        setSelected(current => new Set([...current].filter(key => installations.some(row => row.playKey === key) && !active.has(key))));
        if (!removing.current) setError(warning);
        setLoading(false);
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
    return () => {
      alive.current = false;
      unsubscribe();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [refresh]);

  const filesBytes = rows.reduce((sum, row) => sum + row.installedBytes, 0);
  const removable = rows.filter(row => !activeKeys.has(row.playKey));
  const selectedRows = removable.filter(row => selected.has(row.playKey));
  const groups = groupInstallations(rows);

  async function remove(items: WebPlayInstallation[]) {
    if (removing.current || !items.length) return;
    const bytes = items.reduce((sum, row) => sum + row.installedBytes, 0);
    if (!await confirm(`释放约 ${formatBytes(bytes)}，保留存档和截图。再次游玩需重新下载。`, {
      title: items.length === 1 ? `清理「${items[0].title}」？` : `清理 ${items.length} 项游戏？`,
      confirmLabel: "清理", destructive: true,
    })) return;
    removing.current = true;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let released = 0;
    try {
      for (const item of items) {
        try { await deleteLocalGame(item.playKey); released += item.installedBytes; }
        catch (cause) { failed.push(`${item.title}：${errorMessage(cause)}`); }
      }
      await refresh();
      if (!alive.current) return;
      setSelected(new Set());
      if (released) toast.success(`已清理约 ${formatBytes(released)}`);
      if (failed.length) setError(failed.join("\n"));
    } finally {
      removing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader compact title={<span>已安装游戏{!loading ? <span className="ml-3 align-middle font-sans text-sm font-normal text-muted">{rows.length} 项</span> : null}</span>}
        actions={<Button disabled={busy || !rows.length} onClick={() => { setManaging(value => !value); setSelected(new Set()); }} size="sm" type="button" variant="ghost">{managing ? <Check aria-hidden /> : <ListChecks aria-hidden />}{managing ? "完成" : "批量管理"}</Button>} />
      <div className="flex items-start justify-between gap-3 pb-2 pt-4 sm:items-center">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <HardDrive aria-hidden className="size-4 text-muted" />
          <span>本站占用{usage === null ? " —" : <>约 <strong className="tabular-nums">{formatBytes(usage)}</strong></>}</span>
          <span aria-hidden className="hidden px-1 text-border sm:inline">/</span>
          <span className="w-full pl-6 text-xs text-muted sm:w-auto sm:pl-0">游戏文件 {loading ? "—" : formatBytes(filesBytes)}</span>
        </div>
        <Button disabled={busy || !removable.length} onClick={() => void remove(removable)} size="sm" type="button" variant="ghost">清理全部</Button>
      </div>
      <div className="mb-5 flex items-center gap-1 text-xs text-muted">
        <Clock3 aria-hidden className="mr-0.5 hidden size-3.5 sm:block" />
        <span>为节约存储空间，会自动清理 7 天以上未游玩的游戏。</span>
      </div>
      {error ? <Notice className="mb-5 whitespace-pre-wrap">{error}</Notice> : null}
      {managing && rows.length ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
          <div className="flex items-center gap-4">
            <Label className="flex min-h-9 items-center gap-2 text-sm">
              <Checkbox aria-label="全选可清理的游戏" checked={removable.length > 0 && selectedRows.length === removable.length ? true : selectedRows.length ? "indeterminate" : false}
                disabled={busy || !removable.length} onCheckedChange={checked => setSelected(checked === true ? new Set(removable.map(row => row.playKey)) : new Set())} />全选
            </Label>
            <span className="text-xs text-muted">{selectedRows.length} 项 · {formatBytes(selectedRows.reduce((sum, row) => sum + row.installedBytes, 0))}</span>
          </div>
          <Button disabled={busy || !selectedRows.length} onClick={() => void remove(selectedRows)} size="sm" type="button" variant="destructive">{busy ? "正在清理…" : "清理所选"}</Button>
        </div>
      ) : null}
      {loading ? <p className="py-12 text-sm text-muted" role="status">读取本地游戏…</p> : !rows.length ? (
        <EmptyState className="py-16 text-center" title="暂无已安装游戏" variant="plain" />
      ) : groups.map(group => (
        <section className="mb-6" key={group.key} aria-label={group.label}>
          <div className="mb-2 flex items-baseline gap-2"><h2 className="text-[13px] font-semibold">{group.label}</h2>{group.detail ? <span className="text-xs text-muted">{group.detail}</span> : null}</div>
          <ul className="divide-y divide-border border-y border-border">
            {group.items.map(item => (
              <li className="flex items-start gap-3" key={item.playKey}>
                {managing ? <Label className="flex min-h-11 shrink-0 items-center pt-3.5"><Checkbox aria-label={`选择 ${item.title}`} disabled={busy || activeKeys.has(item.playKey)} checked={selected.has(item.playKey)} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked === true) next.add(item.playKey); else next.delete(item.playKey); return next; })} /></Label> : null}
                <div className="min-w-0 flex-1"><InstalledGameRow item={item} active={activeKeys.has(item.playKey)} actions={managing ? null : (
                  <>
                    {!activeKeys.has(item.playKey) ? <Button asChild className="min-h-11 px-3.5 text-xs" variant="outline"><Link to={`/play/${item.archiveVersionId}`}><Play aria-hidden />{item.status === "ready" ? "游玩" : "重新安装"}</Link></Button> : null}
                    <Button className="min-h-11 px-3 text-xs text-muted" disabled={busy || activeKeys.has(item.playKey)} onClick={() => void remove([item])} type="button" variant="ghost">清理</Button>
                  </>
                )} /></div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageContainer>
  );
}

function InstalledGameRow({ item, active, actions }: { item: WebPlayInstallation; active: boolean; actions: ReactNode }) {
  const [cover, setCover] = useState<{ hash: string; url: string } | null>(null);
  useEffect(() => {
    if (!item.coverBlobSha256) return;
    const hash = item.coverBlobSha256;
    let live = true;
    let url: string | undefined;
    void readCachedWebPlayCover(hash).then(blob => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setCover({ hash, url });
    }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [item.coverBlobSha256]);
  const expires = gameResourceExpiresAt(item);
  const status = active ? "正在使用" : item.status !== "ready" ? "未完成安装" : expires !== null ? `${dateLabel(new Date(expires))}到期` : "";
  return (
    <WorkListRow href={item.workId ? `/games/${item.workId}` : `/play/${item.archiveVersionId}`} title={item.title} originalTitle={item.originalTitle}
      coverSrc={cover?.hash === item.coverBlobSha256 ? cover?.url : null} engineFamily={item.engineFamily}
      action={actions ? <div className="hidden items-center gap-2 min-[561px]:flex">{actions}</div> : null}>
      <p className="mt-1 font-mono text-xs text-muted">归档 #{item.archiveVersionId} / {formatBytes(item.installedBytes)}</p>
      {status ? <p className={`mt-1 text-xs ${active ? "text-secondary" : "text-muted"}`}>{status}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center gap-2 min-[561px]:hidden">{actions}</div> : null}
    </WorkListRow>
  );
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}), month: "long", day: "numeric" }).format(date);
}

function groupInstallations(rows: WebPlayInstallation[]) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, { key: string; label: string; detail?: string; items: WebPlayInstallation[] }>();
  const sorted = [...rows].sort((a, b) => {
    const rank = (row: WebPlayInstallation) => row.status !== "ready" ? 2 : row.lastPlayedAt ? 0 : 1;
    return rank(a) - rank(b) || (b.lastPlayedAt ?? b.readyAt ?? b.updatedAt).localeCompare(a.lastPlayedAt ?? a.readyAt ?? a.updatedAt);
  });
  for (const row of sorted) {
    const date = row.lastPlayedAt ? new Date(row.lastPlayedAt) : null;
    const key = row.status !== "ready" ? "incomplete" : date ? dateKey(date) : "unplayed";
    const relative = key === dateKey(today) ? "今天" : key === dateKey(yesterday) ? "昨天" : null;
    const label = key === "incomplete" ? "未完成安装" : key === "unplayed" ? "尚未游玩" : relative ?? dateLabel(date!);
    if (!groups.has(key)) groups.set(key, { key, label, detail: relative ? dateLabel(date!) : undefined, items: [] });
    groups.get(key)!.items.push(row);
  }
  return [...groups.values()];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "无法读取本地游戏，请重试。";
}
