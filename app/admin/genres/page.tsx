import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getWorkGenreGroup, listWorkGenres } from "@/app/.server/db/work-genres";
import { runtimeContext } from "@/app/.server/router-context";
import { parseAdminPage } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
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
  const result = await listWorkGenres(runtime, query, page);
  const sourceMembers = source ? await getWorkGenreGroup(runtime, source) : [];
  const targetMembers = target ? await getWorkGenreGroup(runtime, target) : [];
  return { query, source, target, page, result, sourceMembers, targetMembers };
}

export const meta: MetaFunction<typeof loader> = ({ error }) =>
  pageMetaDescriptors({ title: ["类型整理", "控制台"] }, error);

export default function AdminGenresPage() {
  const { query, source, target, page, result, sourceMembers, targetMembers } = useLoaderData<typeof loader>();
  const canMerge = sourceMembers.length > 0 && targetMembers.length > 0
    && sourceMembers[0].group_id !== targetMembers[0].group_id;
  return <main className="grid gap-6">
    <PageHeader compact title="类型整理" />
    <RedirectFeedback />
    <Pane heading="合并筛选归属">
      <form action="/admin/genres" method="get" className="grid gap-4 md:grid-cols-2">
        <FormField controlId="genre-source" label="类型 A">
          <Input id="genre-source" name="source" defaultValue={source} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <FormField controlId="genre-target" label="类型 B">
          <Input id="genre-target" name="target" defaultValue={target} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <div><Button type="submit" variant="outline">预览合并</Button></div>
      </form>
      {source && target ? <div className="mt-4 grid gap-3">
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
    </Pane>
    <form action="/admin/genres" method="get" className="flex items-end gap-3">
      <FormField controlId="genre-query" label="搜索类型">
        <Input id="genre-query" name="q" defaultValue={query} maxLength={WORK_GENRE_MAX_LENGTH} />
      </FormField>
      <Button type="submit" variant="outline">搜索</Button>
    </form>
    <TableWrap>
      <thead><tr><th>类型</th><th>筛选组</th><th>使用此名称的公开作品</th></tr></thead>
      <tbody>{result.items.map((genre) => <tr key={genre.id}>
        <td><Link to={`/games?${new URLSearchParams({ genre: genre.name })}`} className="text-primary hover:underline">{genre.name}</Link></td>
        <td>{genre.group_id}</td><td>{genre.public_count}</td>
      </tr>)}</tbody>
    </TableWrap>
    <PaginationLinks basePath="/admin/genres" page={page} pageSize={50} total={result.total} params={{ q: query || undefined }} />
  </main>;
}
