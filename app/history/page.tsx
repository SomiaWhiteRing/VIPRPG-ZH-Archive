import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchAdminAuditLogs } from "@/app/.server/db/admin-audit";
import { parsePositiveId } from "@/app/.server/http/request";
import { throwNotFound } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { AUDIT_TARGET_LABELS, auditRecord, entityAuditChanges, entityAuditTargets } from "@/lib/entity-audit";
import { entryHistoryChanges, entryHistoryRangeChanges, entryHistorySnapshots, entryHistoryValueText, type EntryHistoryKind } from "@/lib/entry-history";
import { formatExactTimestamp, parseTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { Form, Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useState } from "react";

const entries = {
  work: { path: "games", sql: "SELECT COALESCE(chinese_title,original_title) AS name FROM works WHERE id=?" },
  creator: { path: "creators", sql: "SELECT name FROM creators WHERE id=?" },
  character: { path: "characters", sql: "SELECT primary_name AS name FROM characters WHERE id=?" },
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const url = new URL(request.url);
  await requirePagePermission(runtime, url.pathname + url.search, "audit.read");
  if (!params.kind || !Object.hasOwn(entries, params.kind)) throwNotFound();
  const kind = params.kind as EntryHistoryKind;
  const id = parsePositiveId(params.id!, "entry id");
  const page = parseAccountPage(url.searchParams.get("page") ?? undefined);
  const entry = await runtime.db.prepare(entries[kind].sql).bind(id).first<{ name: string }>();
  const result = await searchAdminAuditLogs(runtime, { targetType: kind, targetId: String(id), page, pageSize: 20 });
  if (!entry && !result.total) throwNotFound();
  const oldName = result.items.flatMap(log => entityAuditTargets(log.detail)).find(target => target.type === kind && String(target.id) === String(id))?.name;
  const revisions = await searchAdminAuditLogs(runtime, { targetType: kind, targetId: String(id), snapshotsOnly: true, pageSize: 1 });
  const latest = revisions.items[0];
  const earliest = revisions.total <= 1 ? latest
    : (await searchAdminAuditLogs(runtime, { targetType: kind, targetId: String(id), snapshotsOnly: true, page: revisions.total, pageSize: 1 })).items[0];
  const oldParam = url.searchParams.get("oldid");
  const diffParam = url.searchParams.get("diff");
  const oldId = oldParam === null ? null : parsePositiveId(oldParam, "revision id");
  const diff = diffParam === null || diffParam === "prev" || diffParam === "cur" ? diffParam : parsePositiveId(diffParam, "revision id");
  if (diff !== null && oldId === null) throwNotFound();

  async function revision(logId: number) {
    const log = result.items.find(item => item.id === logId)
      ?? (await searchAdminAuditLogs(runtime, { targetType: kind, targetId: String(id), logId })).items[0];
    if (!log) throwNotFound();
    const detail = auditRecord(log.detail);
    if (!detail || !Object.hasOwn(detail, "before") || !Object.hasOwn(detail, "after")) throwNotFound();
    if (!result.items.some(item => item.id === log.id)) result.items.push(log);
    return { id: log.id, date: log.createdAt, detail: log.detail, after: entryHistorySnapshots(log.detail, kind, id).after };
  }
  let selection = null;
  if (oldId !== null) {
    const older = await revision(oldId);
    const newer = diff === "cur" ? await revision(latest!.id) : typeof diff === "number" ? await revision(diff) : older;
    if ((diff === "cur" || typeof diff === "number")
      && (parseTimestamp(older.date).getTime() - parseTimestamp(newer.date).getTime() || older.id - newer.id) >= 0) {
      throw new Response(null, { status: 400 });
    }
    const previous = diff === "prev" ? (await searchAdminAuditLogs(runtime, {
      targetType: kind, targetId: String(id), snapshotsOnly: true, before: { createdAt: older.date, id: older.id }, pageSize: 1,
    })).items[0] : null;
    if (diff === "prev" && !previous) throw new Response(null, { status: 400 });
    if (previous && !result.items.some(item => item.id === previous.id)) result.items.push(previous);
    let fields;
    if (diff === null) fields = entityAuditChanges(null, newer.after);
    else if (diff === "prev") fields = entryHistoryChanges(newer.detail, kind, id);
    else {
      const edits = [newer.detail];
      let before = { createdAt: newer.date, id: newer.id };
      while (true) {
        const batch = await searchAdminAuditLogs(runtime, {
          targetType: kind, targetId: String(id), after: { createdAt: older.date, id: older.id }, before, pageSize: 500,
        });
        edits.push(...batch.items.map(log => log.detail));
        if (batch.items.length === batch.total) break;
        const last = batch.items.at(-1)!;
        before = { createdAt: last.createdAt, id: last.id };
      }
      fields = entryHistoryRangeChanges(edits.reverse(), kind, id);
    }
    selection = {
      oldId: diff === "prev" ? previous?.id ?? null : older.id, newId: newer.id, snapshot: diff === null,
      oldDate: diff === "prev" ? previous?.createdAt ?? null : older.date, newDate: newer.date,
      fields,
    };
  }
  return {
    title: entry?.name ?? oldName ?? `${AUDIT_TARGET_LABELS[kind]} #${id}`,
    entryHref: entry ? `/${entries[kind].path}/${id}` : null,
    basePath: `/history/${kind}/${id}`,
    total: result.total, page: result.page, pageSize: result.pageSize,
    latestId: latest?.id, selection,
    items: result.items.sort((a, b) => parseTimestamp(b.createdAt).getTime() - parseTimestamp(a.createdAt).getTime() || b.id - a.id).map(log => {
      const historicalName = auditRecord(auditRecord(log.detail)?.actor)?.displayName;
      return {
        id: log.id, createdAt: log.createdAt, actorId: log.userId,
        actorName: typeof historicalName === "string" ? historicalName : log.actorName ?? (log.userId ? `用户 #${log.userId}` : "系统"),
        hasSnapshot: Object.hasOwn(auditRecord(log.detail) ?? {}, "before") && Object.hasOwn(auditRecord(log.detail) ?? {}, "after"),
        hasPrevious: log.id !== earliest?.id,
        fields: [...new Set(entryHistoryChanges(log.detail, kind, id).map(change => change.field.split(" / ")[0]))],
      };
    }),
  };
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) => [
  ...pageMetaDescriptors({ title: [loaderData?.title ?? "条目", "编辑历史"], page: loaderData?.page }, error),
  { name: "robots", content: "noindex" },
];

export default function EntryHistoryPage() {
  const history = useLoaderData<typeof loader>();
  const revisions = history.items.filter(entry => entry.hasSnapshot);
  const selection = history.selection;
  const olderEditor = history.items.find(entry => entry.id === selection?.oldId);
  const newerEditor = history.items.find(entry => entry.id === selection?.newId);
  const selectedOlderIndex = revisions.findIndex(entry => entry.id === selection?.oldId);
  const selectedNewerIndex = revisions.findIndex(entry => entry.id === selection?.newId);
  const defaults = selection && !selection.snapshot
    ? { olderIndex: selectedOlderIndex, newerIndex: selectedNewerIndex }
    : { olderIndex: revisions.length > 1 ? 1 : -1, newerIndex: revisions.length ? 0 : -1 };
  const [picked, setPicked] = useState({ source: history, ...defaults });
  const choice = picked.source === history ? picked : { source: history, ...defaults };
  function revisionHref(id: number, diff?: number | "prev" | "cur") {
    const params = new URLSearchParams({ oldid: String(id) });
    if (diff !== undefined) params.set("diff", String(diff));
    if (history.page > 1) params.set("page", String(history.page));
    return `${history.basePath}?${params}`;
  }
  return <PageContainer>
    {history.entryHref ? <BackLink className="mb-4" href={history.entryHref} label="返回条目" variant="text" /> : null}
    <PageHeader compact title={`${history.title} · 编辑历史`} />
    {selection ? <section className="mt-5 min-w-0" aria-label={selection.snapshot ? "版本内容" : "版本差异"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{selection.snapshot ? "版本内容" : "版本差异"}</h2>
      </div>
      <div className={selection.snapshot ? "border-b border-border py-2 text-sm" : "grid grid-cols-2 gap-3 border-b border-border py-2 text-sm"}>
        {!selection.snapshot && <p className="flex flex-wrap items-baseline gap-x-2">
          <span>{selection.oldDate ? formatExactTimestamp(selection.oldDate) : "此前版本"}</span><HistoryEditor entry={olderEditor} />
        </p>}
        <p className="flex flex-wrap items-baseline gap-x-2"><span>{formatExactTimestamp(selection.newDate)}</span><HistoryEditor entry={newerEditor} /></p>
      </div>
      {selection.fields.length ? selection.fields.map((change, index) => <div key={index} className="min-w-0 border-b border-border py-3">
        <h3 className="mb-2 text-sm font-semibold wrap-anywhere">{change.field}</h3>
        <div className={selection.snapshot ? "min-w-0" : "grid min-w-0 gap-3 md:grid-cols-2"}>
          {!selection.snapshot && <pre className="min-w-0 whitespace-pre-wrap wrap-anywhere border-l-4 border-destructive/50 bg-destructive/5 p-3 font-sans text-sm">{entryHistoryValueText(change.field, change.before)}</pre>}
          <pre className="min-w-0 whitespace-pre-wrap wrap-anywhere border-l-4 border-primary/50 bg-primary/5 p-3 font-sans text-sm">{entryHistoryValueText(change.field, change.after)}</pre>
        </div>
      </div>) : <EmptyState title="没有字段差异。" variant="plain" />}
    </section> : null}
    {history.items.length ? <Form method="get" className="mt-5" aria-label="比较历史版本">
      {history.page > 1 && <input type="hidden" name="page" value={history.page} />}
      <Button type="submit" variant="outline" disabled={choice.newerIndex < 0 || choice.olderIndex <= choice.newerIndex}>比较所选版本</Button>
      <div className="mt-3 flex gap-2 text-xs text-muted" aria-hidden><span className="w-8 text-center">较旧</span><span className="w-8 text-center">较新</span></div>
      <ol className="mt-1 min-w-0 border-y border-border py-1">
        {history.items.map(entry => {
          const index = revisions.findIndex(revision => revision.id === entry.id);
          return <li key={entry.id} className="flex min-w-0 items-start gap-2 py-1 text-sm">
          <div className="flex shrink-0 gap-2">
            <Label className="flex size-8 items-center justify-center">
              <Input type="radio" name="oldid" value={entry.id} required disabled={!entry.hasSnapshot || index <= choice.newerIndex}
                checked={index >= 0 && index === choice.olderIndex}
                onChange={() => setPicked({ ...choice, olderIndex: index })}
                aria-label={`较旧版本：${formatExactTimestamp(entry.createdAt)}`} className="size-4 shrink-0 accent-primary p-0 shadow-none" />
            </Label>
            <Label className="flex size-8 items-center justify-center">
              <Input type="radio" name="diff" value={entry.id} required disabled={!entry.hasSnapshot || (choice.olderIndex >= 0 && index >= choice.olderIndex)}
                checked={index >= 0 && index === choice.newerIndex}
                onChange={() => setPicked({ ...choice, newerIndex: index })}
                aria-label={`较新版本：${formatExactTimestamp(entry.createdAt)}`} className="size-4 shrink-0 accent-primary p-0 shadow-none" />
            </Label>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
            <span className="whitespace-nowrap text-primary">(
              {entry.hasSnapshot && entry.id !== history.latestId ? <Link to={revisionHref(entry.id, "cur")} className="hover:underline">当前</Link> : <span className="text-muted">当前</span>}
              {" | "}{entry.hasSnapshot && entry.hasPrevious ? <Link to={revisionHref(entry.id, "prev")} className="hover:underline">前次</Link> : <span className="text-muted">前次</span>}
            )</span>
            {entry.hasSnapshot ? <Link to={revisionHref(entry.id)} className="font-mono tabular-nums text-primary hover:underline">{formatExactTimestamp(entry.createdAt)}</Link>
              : <span className="font-mono tabular-nums">{formatExactTimestamp(entry.createdAt)}</span>}
            <HistoryEditor entry={entry} />
            <span className="min-w-0 wrap-anywhere text-muted">（{entry.hasSnapshot ? entry.fields.join("、") || "无字段变化" : "无快照"}）</span>
          </div>
        </li>; })}
      </ol>
    </Form> : <EmptyState title="暂无编辑历史。" />}
    <PaginationLinks basePath={history.basePath} page={history.page} pageSize={history.pageSize} total={history.total} />
  </PageContainer>;
}

function HistoryEditor({ entry }: { entry?: { actorId: number | null; actorName: string } }) {
  if (!entry) return null;
  return entry.actorId ? <Link to={`/users/${entry.actorId}`} className="text-primary hover:underline">{entry.actorName}</Link> : <span>{entry.actorName}</span>;
}
