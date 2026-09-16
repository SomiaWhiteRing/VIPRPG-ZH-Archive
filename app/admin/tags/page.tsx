import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchTagsForAdmin } from "@/app/.server/db/taxonomy-library";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/tags",
    "tag.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const namespace = allowed(
    searchParam(params.status),
    ["all", "genre", "theme", "character", "technical", "content", "other"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name", "works"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchTagsForAdmin(runtime, {
    query,
    namespace,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    namespace,
    sort,
    page,
    result,
  };
}

export default function AdminTagsPage() {
  const { adminUser, query, namespace, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="标签维护"
        subtitle="维护标签命名空间、说明和作品关联。"
        actions={
          <Link className={buttonVariants({ variant: "outline" })} to="/tags">
            查看公开列表
          </Link>
        }
      />
      <AdminListControls
        action="/admin/tags"
        noun="标签"
        query={query}
        status={namespace}
        statusOptions={[
          { value: "all", label: "全部命名空间" },
          { value: "genre", label: "类型" },
          { value: "theme", label: "主题" },
          { value: "character", label: "角色相关" },
          { value: "technical", label: "技术" },
          { value: "content", label: "内容" },
          { value: "other", label: "其他" },
        ]}
        sort={sort}
        sortOptions={[
          { value: "default", label: "最近更新" },
          { value: "name", label: "名称" },
          { value: "works", label: "关联作品数" },
        ]}
        total={result.total}
      />
      {result.items.length > 0 ? (
        <TableWrap compact label="标签列表" minWidth={900}>
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
                <td>{formatNumber(tag.workCount)} 个游戏</td>
                <td>
                  {hasPermission(adminUser, "tag.metadata.update_any") ? (
                    <Link
                      className={buttonVariants()}
                      to={`/admin/tags/${tag.id}`}
                    >
                      编辑
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">只读</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="没有找到匹配的标签。" />
      )}
      <PaginationLinks
        basePath="/admin/tags"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          status: namespace === "all" ? undefined : namespace,
          sort: sort === "default" ? undefined : sort,
        }}
      />
    </main>
  );
}

function allowed<T extends string>(
  value: string,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
