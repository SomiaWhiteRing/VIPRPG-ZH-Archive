import { parseAccountPage, requireAccountUser } from "@/app/.server/auth/account-user";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { searchAdminAuditLogs } from "@/app/.server/db/admin-audit";
import { getEntryHistoryNames } from "@/app/.server/db/entry-history";
import { parsePositiveId } from "@/app/.server/http/request";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { getWorkEditInfoHref } from "@/app/.server/work-overview-sidebar";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { CREATOR_PUBLIC_EDIT_PERMISSIONS } from "@/lib/authz/creator-permissions";
import { CHARACTER_EDIT_PERMISSIONS, hasPermission } from "@/lib/authz/permissions";
import { AUDIT_TARGET_LABELS, auditRecord, entityAuditTargets } from "@/lib/entity-audit";
import { entryHistoryChanges, entryHistoryRangeChanges, entryHistorySnapshots, entryHistorySummary, type EntryHistoryKind, type EntryHistoryValue } from "@/lib/entry-history";
import { formatExactTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { Form, Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useState } from "react";

const entries = {
  work: { path: "games", sql: "SELECT COALESCE(chinese_title,original_title) AS name,status FROM works WHERE id=?" },
  creator: { path: "creators", sql: "SELECT name,public_at AS publicAt FROM creators WHERE id=?" },
  character: { path: "characters", sql: "SELECT primary_name AS name FROM characters WHERE id=?" },
};

const PAGE_SIZE = 20;
const AUDIT_BATCH_SIZE = 100;
const PORTRAIT_ROWS = ["top-0", "-top-[48px]", "-top-[96px]", "-top-[144px]"];
const PORTRAIT_COLUMNS = ["left-0", "-left-[48px]", "-left-[96px]", "-left-[144px]"];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const url = new URL(request.url);
  if (!params.kind || !Object.hasOwn(entries, params.kind)) throwNotFound();
  const kind = params.kind as EntryHistoryKind;
  const id = parsePositiveId(params.id!, "entry id");
  const nextPath = url.pathname + url.search;
  const user = kind === "work" ? await requireAccountUser(runtime, nextPath)
    : await requireAnyPagePermission(runtime, nextPath, kind === "creator" ? CREATOR_PUBLIC_EDIT_PERMISSIONS : CHARACTER_EDIT_PERMISSIONS);
  const entry = await runtime.db.prepare(entries[kind].sql).bind(id).first<{ name: string; status?: string; publicAt?: string | null }>();
  if (kind === "work" && !await getWorkEditInfoHref(runtime, id, user, entry?.status === "deleted")) redirectPage("/");
  if (kind === "creator" && !entry?.publicAt && !hasPermission(user, "creator.metadata.update_any")) throwNotFound();

  const oldParam = url.searchParams.get("oldid");
  const diffParam = url.searchParams.get("diff");
  const oldId = oldParam === null ? null : parsePositiveId(oldParam, "revision id");
  const diff = diffParam === null || diffParam === "prev" || diffParam === "cur" ? diffParam : parsePositiveId(diffParam, "revision id");
  if (diff !== null && oldId === null) throwNotFound();

  const candidates = [];
  const targetId = String(id);
  let oldName: string | null | undefined;
  let before: { createdAt: string; id: number } | undefined;
  while (true) {
    const batch = await searchAdminAuditLogs(runtime, {
      targetType: kind, targetId, before, pageSize: AUDIT_BATCH_SIZE,
    });
    if (!before && !entry && !batch.total) throwNotFound();
    for (const log of batch.items) {
      if (!entry && !oldName) oldName = entityAuditTargets(log.detail)
        .find(target => target.type === kind && String(target.id) === targetId)?.name;
      const detail = auditRecord(log.detail);
      if (!detail || !Object.hasOwn(detail, "before") || !Object.hasOwn(detail, "after")) continue;
      const snapshots = entryHistorySnapshots(detail, kind, id);
      const historicalName = auditRecord(detail?.actor)?.displayName;
      candidates.push({
        id: log.id, createdAt: log.createdAt, actorId: log.userId,
        actorName: typeof historicalName === "string" ? historicalName : log.actorName ?? (log.userId ? "用户" : "系统"),
        snapshots,
      });
    }
    const last = batch.items.at(-1);
    if (!last || batch.items.length >= batch.total) break;
    before = { createdAt: last.createdAt, id: last.id };
  }

  const names = await getEntryHistoryNames(runtime, user, candidates.map(item => item.snapshots));
  const revisions = candidates.flatMap((item, candidateIndex) => {
    const changes = entryHistoryChanges(item.snapshots.before, item.snapshots.after, kind, id, names);
    return changes.length ? [{ ...item, changes, candidateIndex }] : [];
  });
  let selection = null;
  if (oldId !== null) {
    const olderIndex = revisions.findIndex(item => item.id === oldId);
    const newerIndex = diff === "cur" ? 0 : typeof diff === "number" ? revisions.findIndex(item => item.id === diff) : olderIndex;
    const older = revisions[olderIndex];
    const newer = revisions[newerIndex];
    if (!older || !newer) throwNotFound();
    if ((diff === "cur" || typeof diff === "number") && olderIndex <= newerIndex) {
      throw new Response(null, { status: 400 });
    }
    const previous = diff === "prev" ? revisions[olderIndex + 1] : null;
    if (diff === "prev" && !previous) throw new Response(null, { status: 400 });
    let fields;
    if (diff === null) fields = entryHistoryChanges(null, newer.snapshots.after, kind, id, names);
    else if (diff === "prev") fields = newer.changes;
    else {
      // A hidden edit can replace an internal relation ID used by later snapshots.
      const edits = candidates.slice(newer.candidateIndex, older.candidateIndex).reverse().map(item => item.snapshots);
      fields = entryHistoryRangeChanges(edits, kind, id, names);
    }
    selection = {
      oldId: (previous ?? older).id, newId: newer.id, snapshot: diff === null,
      oldDate: (previous ?? older).createdAt, newDate: newer.createdAt,
      fields,
    };
  }
  const page = Math.min(parseAccountPage(url.searchParams.get("page") ?? undefined), Math.max(1, Math.ceil(revisions.length / PAGE_SIZE)));
  const offset = (page - 1) * PAGE_SIZE;
  const earliestId = revisions.at(-1)?.id;
  return {
    title: entry?.name ?? oldName ?? AUDIT_TARGET_LABELS[kind],
    entryHref: entry ? `/${entries[kind].path}/${id}` : null,
    basePath: `/history/${kind}/${id}`,
    total: revisions.length, page, pageSize: PAGE_SIZE,
    latestId: revisions[0]?.id, selection,
    items: revisions.filter((item, index) => (index >= offset && index < offset + PAGE_SIZE)
      || item.id === selection?.oldId || item.id === selection?.newId)
      .map(({ snapshots: _snapshots, candidateIndex: _candidateIndex, changes, ...item }) => ({
        ...item,
        hasPrevious: item.id !== earliestId,
        summary: entryHistorySummary(changes),
      })),
  };
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) => [
  ...pageMetaDescriptors({ title: [loaderData?.title ?? "条目", "编辑历史"], page: loaderData?.page }, error),
  { name: "robots", content: "noindex" },
];

export default function EntryHistoryPage() {
  const history = useLoaderData<typeof loader>();
  const revisions = history.items;
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
          {!selection.snapshot && <div className="min-w-0 border-l-4 border-destructive/50 bg-destructive/5 p-3 text-sm">
            <HistoryValues field={change.field} values={change.before} />
          </div>}
          <div className="min-w-0 border-l-4 border-primary/50 bg-primary/5 p-3 text-sm">
            <HistoryValues field={change.field} values={change.after} />
          </div>
        </div>
      </div>) : <EmptyState title="没有字段差异。" variant="plain" />}
    </section> : null}
    {history.items.length ? <Form method="get" className="mt-5" aria-label="比较历史版本">
      {history.page > 1 && <input type="hidden" name="page" value={history.page} />}
      <Button type="submit" variant="outline" disabled={choice.newerIndex < 0 || choice.olderIndex <= choice.newerIndex}>比较所选版本</Button>
      <div className="mt-3 flex gap-2 text-xs text-muted" aria-hidden><span className="w-8 text-center">较旧</span><span className="w-8 text-center">较新</span></div>
      <ol className="mt-1 min-w-0 border-y border-border py-1">
        {revisions.map((entry, index) => {
          return <li key={entry.id} className="flex min-w-0 items-start gap-2 py-1 text-sm">
          <div className="flex shrink-0 gap-2">
            <Label className="flex size-8 items-center justify-center">
              <Input type="radio" name="oldid" value={entry.id} required disabled={index <= choice.newerIndex}
                checked={index >= 0 && index === choice.olderIndex}
                onChange={() => setPicked({ ...choice, olderIndex: index })}
                aria-label={`较旧版本：${formatExactTimestamp(entry.createdAt)}`} className="size-4 shrink-0 accent-primary p-0 shadow-none" />
            </Label>
            <Label className="flex size-8 items-center justify-center">
              <Input type="radio" name="diff" value={entry.id} required disabled={choice.olderIndex >= 0 && index >= choice.olderIndex}
                checked={index >= 0 && index === choice.newerIndex}
                onChange={() => setPicked({ ...choice, newerIndex: index })}
                aria-label={`较新版本：${formatExactTimestamp(entry.createdAt)}`} className="size-4 shrink-0 accent-primary p-0 shadow-none" />
            </Label>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
            <span className="whitespace-nowrap text-primary">(
              {entry.id !== history.latestId ? <Link to={revisionHref(entry.id, "cur")} className="hover:underline">当前</Link> : <span className="text-muted">当前</span>}
              {" | "}{entry.hasPrevious ? <Link to={revisionHref(entry.id, "prev")} className="hover:underline">前次</Link> : <span className="text-muted">前次</span>}
            )</span>
            <Link to={revisionHref(entry.id)} className="font-mono tabular-nums text-primary hover:underline">{formatExactTimestamp(entry.createdAt)}</Link>
            <HistoryEditor entry={entry} />
            <span className="min-w-0 wrap-anywhere text-muted">（{entry.summary}）</span>
          </div>
        </li>; })}
      </ol>
    </Form> : <EmptyState title="暂无编辑历史。" />}
    <PaginationLinks basePath={history.basePath} page={history.page} pageSize={history.pageSize} total={history.total} />
  </PageContainer>;
}

function HistoryValues({ field, values }: { field: string; values: EntryHistoryValue[] }) {
  if (!values.length) return <span className="text-muted">（空）</span>;
  return <div className="flex flex-wrap gap-x-4 gap-y-3">
    {values.map(({ text, image, cell }, index) => <div key={index} className={text ? "flex min-w-0 basis-full items-start gap-2" : "min-w-0 max-w-full"}>
      {image && (cell ? (
        <span className="relative size-[48px] shrink-0 overflow-clip rounded [image-rendering:pixelated]">
          <img alt={field} src={image} loading="lazy"
            className={`absolute max-w-none ${PORTRAIT_ROWS[cell.row]} ${PORTRAIT_COLUMNS[cell.column]}`} />
        </span>
      ) : <img alt={field} src={image} loading="lazy" className="max-h-36 max-w-full rounded object-contain" />)}
      {text ? <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{text}</span> : null}
    </div>)}
  </div>;
}

function HistoryEditor({ entry }: { entry?: { actorId: number | null; actorName: string } }) {
  if (!entry) return null;
  return entry.actorId ? <Link to={`/users/${entry.actorId}`} className="text-primary hover:underline">{entry.actorName}</Link> : <span>{entry.actorName}</span>;
}
