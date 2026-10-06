import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getWorkGenreGroup, listWorkGenreGroups } from "@/app/.server/db/work-genres";
import { runtimeContext } from "@/app/.server/router-context";
import { parseAdminPage } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
import { Pencil } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  await requirePagePermission(runtime, "/admin/genres", "genre.manage");
  const params = new URL(args.request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const source = (params.get("source") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const target = (params.get("target") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const page = parseAdminPage(params.get("page") ?? undefined);
  const result = await listWorkGenreGroups(runtime, query, page);
  const sourceMembers = source ? await getWorkGenreGroup(runtime, source) : [];
  const targetMembers = target ? await getWorkGenreGroup(runtime, target) : [];
  return { query, source, target, page, result, sourceMembers, targetMembers };
}

export const meta: MetaFunction<typeof loader> = ({ error }) =>
  pageMetaDescriptors({ title: ["类型整理", "控制台"] }, error);

export default function AdminGenresPage() {
  const { query, source, target, page, result, sourceMembers, targetMembers } = useLoaderData<typeof loader>();
  const [sourceValue, setSourceValue] = useState(source);
  const [targetValue, setTargetValue] = useState(target);
  const sourceInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const mergePanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setSourceValue(source);
    setTargetValue(target);
  }, [source, target]);
  const emptySlot = !sourceValue.trim() ? "A" : !targetValue.trim() ? "B" : null;
  const previewMatches = sourceValue.trim() === source && targetValue.trim() === target;
  const canMerge = sourceMembers.length > 0 && targetMembers.length > 0
    && sourceMembers[0].group_id !== targetMembers[0].group_id;
  function fillMergeSlot(name: string) {
    if (mergePanel.current) mergePanel.current.open = true;
    if (emptySlot === "A") {
      setSourceValue(name);
      sourceInput.current?.focus();
    } else if (emptySlot === "B") {
      setTargetValue(name);
      targetInput.current?.focus();
    }
  }
  return <main className="grid gap-6">
    <PageHeader compact title="类型整理" />
    <RedirectFeedback />
    <details ref={mergePanel} className="admin-panel admin-details" open={Boolean(source || target)}>
      <summary>合并筛选归属</summary>
      <form action="/admin/genres" method="get" className="mt-4 grid gap-4 md:grid-cols-2">
        <input type="hidden" name="q" value={query} />
        <input type="hidden" name="page" value={page} />
        <FormField controlId="genre-source" label="类型 A">
          <Input id="genre-source" name="source" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} ref={sourceInput} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <FormField controlId="genre-target" label="类型 B">
          <Input id="genre-target" name="target" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} ref={targetInput} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <div><Button type="submit" variant="outline">预览合并</Button></div>
      </form>
      {source && target && previewMatches ? <div className="mt-4 grid gap-3">
        <p>作品原文和各类型名称保持不变，合并后筛选任一名称都会包含两组作品。</p>
        <p>类型 A：{sourceMembers.map((member) => member.name).join("、") || "未找到类型"}</p>
        <p>类型 B：{targetMembers.map((member) => member.name).join("、") || "未找到类型"}</p>
        {canMerge ? <RedirectForm action="/api/admin/genres/merge" method="post">
          <input type="hidden" name="source_group" value={sourceMembers[0].group_id} />
          <input type="hidden" name="target_group" value={targetMembers[0].group_id} />
          <input type="hidden" name="source_snapshot" value={sourceMembers.map((member) => member.id).join(",")} />
          <input type="hidden" name="target_snapshot" value={targetMembers.map((member) => member.id).join(",")} />
          <Button type="submit">确认合并两组</Button>
        </RedirectForm> : sourceMembers.length && targetMembers.length ? <p>这两个类型已经属于同一组。</p> : null}
      </div> : null}
    </details>
    <form action="/admin/genres" method="get" className="admin-filter-row">
      <input type="hidden" name="source" value={sourceValue} />
      <input type="hidden" name="target" value={targetValue} />
      <div className="admin-field admin-field-search"><FormField controlId="genre-query" label="搜索类型">
        <Input id="genre-query" name="q" defaultValue={query} maxLength={WORK_GENRE_MAX_LENGTH} />
      </FormField></div>
      <Button type="submit" variant="outline">搜索</Button>
    </form>
    <AdminListMeta total={result.total} noun="类型组" pageSize={50} />
    <ul aria-label="类型" className="admin-panel m-0 flex list-none flex-wrap items-start gap-2">
      {result.items.map((group) => <li key={group.id} className="inline-flex min-h-7.5 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-secondary/30 px-2.75 py-1 text-sm font-medium text-secondary">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {group.members.map((genre, index) => <Fragment key={genre.id}>
            {index ? "，" : null}
            <Link to={`/games?${new URLSearchParams({ genre: genre.name })}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{genre.name}</Link>
          </Fragment>)}
        </span>
        <small className="shrink-0 font-mono text-[10px] font-normal tabular-nums" aria-label={`${group.publicCount} 个公开游戏`}>{formatNumber(group.publicCount)}</small>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 min-h-0 rounded-full p-0 text-current hover:bg-secondary/10 hover:text-secondary [&_svg]:size-3"
          aria-label={`将 ${group.members.map((genre) => genre.name).join("，")} 填入合并类型${emptySlot ? ` ${emptySlot}` : ""}`}
          title={emptySlot ? `填入类型 ${emptySlot}` : "请先清空一个类型输入框"}
          disabled={!emptySlot}
          onClick={() => fillMergeSlot(group.members[0].name)}
        ><Pencil aria-hidden /></Button>
      </li>)}
    </ul>
    <PaginationLinks basePath="/admin/genres" page={page} pageSize={50} total={result.total} params={{ q: query || undefined, source: sourceValue || undefined, target: targetValue || undefined }} />
  </main>;
}
