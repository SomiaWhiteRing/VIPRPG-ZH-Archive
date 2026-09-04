import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AdminListControls, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { searchCreatorsForAdmin } from "@/lib/server/db/creator-library";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminCreatorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("/admin/creators", "creator.read_private");
  const params = await searchParams;
  const query = searchParam(params.q);
  const sort = allowed(searchParam(params.sort), ["default", "name", "works"], "default");
  const page = parseAdminPage(params.page);
  const result = await searchCreatorsForAdmin({ query, sort, page, pageSize: PAGE_SIZE });

  return (
    <main>
      <PageHeader
        compact
        title="作者与制作人员维护"
        subtitle="维护作者身份、公开资料和作品关联。"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/creators">查看公开列表</Link>}
      />
      <AdminListControls action="/admin/creators" noun="作者" query={query} sort={sort} sortOptions={[{ value: "default", label: "最近更新" }, { value: "name", label: "名称" }, { value: "works", label: "关联作品数" }]} total={result.total} />
      {result.items.length > 0 ? <TableWrap compact label="作者列表" minWidth={900}>
        <thead>
          <tr>
            <th>作者</th>
            <th>关联</th>
            <th>链接</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((creator) => (
            <tr key={creator.id}>
              <td>
                <strong>{creator.name}</strong>
                {creator.originalName ? <span className="text-sm text-muted">{creator.originalName}</span> : null}
              </td>
              <td>
                {formatNumber(creator.workCreditCount)} 个游戏
                {creator.latestWorkCreditAt ? (
                  <span className="text-sm text-muted">最近关联：{creator.latestWorkCreditAt}</span>
                ) : null}
              </td>
              <td>
                {creator.websiteUrl ? (
                  <a href={creator.websiteUrl} rel="noreferrer" target="_blank">
                    个人链接
                  </a>
                ) : (
                  <span className="text-sm text-muted">未填写</span>
                )}
              </td>
              <td>
                <Link className={buttonVariants()} href={`/admin/creators/${creator.id}`}>编辑</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap> : <EmptyState title="没有找到匹配的作者。" />}
      <PaginationLinks basePath="/admin/creators" page={page} pageSize={PAGE_SIZE} total={result.total} params={{ q: query || undefined, sort: sort === "default" ? undefined : sort }} />
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
