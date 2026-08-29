import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { AdminListControls, AdminPagination, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { searchTagsForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminTagsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("/admin/tags", "tag.read_private");
  const params = await searchParams;
  const query = searchParam(params.q);
  const namespace = allowed(searchParam(params.status), ["all", "genre", "theme", "character", "technical", "content", "other"], "all");
  const sort = allowed(searchParam(params.sort), ["default", "name", "works"], "default");
  const page = parseAdminPage(params.page);
  const result = await searchTagsForAdmin({ query, namespace, sort, page, pageSize: PAGE_SIZE });

  return (
    <main>
      <PageHeader
        compact
        title="标签维护"
        subtitle="维护标签命名空间、说明和作品关联。"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/tags">查看公开列表</Link>}
      />
      <AdminListControls action="/admin/tags" noun="标签" query={query} status={namespace} statusOptions={[{ value: "all", label: "全部命名空间" }, { value: "genre", label: "类型" }, { value: "theme", label: "主题" }, { value: "character", label: "角色相关" }, { value: "technical", label: "技术" }, { value: "content", label: "内容" }, { value: "other", label: "其他" }]} sort={sort} sortOptions={[{ value: "default", label: "最近更新" }, { value: "name", label: "名称" }, { value: "works", label: "关联作品数" }]} total={result.total} />
      {result.items.length > 0 ? <TableWrap compact label="标签列表" minWidth={900}>
        <thead>
          <tr>
            <th>标签</th>
            <th>命名空间</th>
            <th>关联</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((tag) => (
            <tr key={tag.id}>
              <td>
                <strong>{tag.name}</strong>
              </td>
              <td>{namespaceLabel(tag.namespace)}</td>
              <td>
                {formatNumber(tag.workCount)} 个游戏
              </td>
              <td>
                <Link className={buttonVariants()} href={`/admin/tags/${tag.id}`}>编辑</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap> : <EmptyState title="没有找到匹配的标签。" />}
      <AdminPagination basePath="/admin/tags" page={page} pageSize={PAGE_SIZE} total={result.total} params={{ q: query || undefined, status: namespace === "all" ? undefined : namespace, sort: sort === "default" ? undefined : sort }} />
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
