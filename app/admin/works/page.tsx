import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchEditableWorksForAdmin } from "@/app/.server/db/game-library";
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
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatBytes, formatNumber } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/works",
    "work.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(
    searchParam(params.status),
    ["all", "published", "processing", "hidden", "deleted"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "title", "release"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchEditableWorksForAdmin(runtime, {
    query,
    status,
    sort: sort === "default" ? "id" : sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    status,
    sort,
    page,
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["作品资料维护", "控制台"], page: loaderData?.page }, error);

export default function AdminWorksPage() {
  const { adminUser, query, status, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="作品资料维护"
        subtitle="维护作品发布状态、分发方式和关联资料。"
      />
      <AdminListControls
        action="/admin/works"
        noun="作品"
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: "最近创建" },
          { value: "title", label: "标题" },
          { value: "release", label: "发布日期" },
        ]}
        status={status}
        statusOptions={[
          { value: "all", label: "全部状态" },
          { value: "published", label: "已发布" },
          { value: "processing", label: "处理中" },
          { value: "hidden", label: "隐藏" },
          { value: "deleted", label: "已删除" },
        ]}
        total={result.total}
      />

      {result.items.length > 0 ? (
        <TableWrap compact label="作品列表" minWidth={980}>
          <thead>
            <tr>
              <th>作品</th>
              <th>状态</th>
              <th>规模</th>
              <th>标签</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((work) => (
              <tr key={work.id}>
                <td>
                  <strong>{work.chineseTitle || work.originalTitle}</strong>
                  {work.chineseTitle ? (
                    <span className="text-sm text-muted">
                      {work.originalTitle}
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusBadge kind="publication" value={work.status} />
                </td>
                <td>
                  {work.distribution === "external" ? (
                    <span>外部下载</span>
                  ) : (
                    <>
                      {formatNumber(work.archiveVersionCount)} 个归档快照
                      <span className="text-sm text-muted">
                        {formatBytes(work.totalSizeBytes)}
                      </span>
                    </>
                  )}
                </td>
                <td>
                  {work.tags.length > 0 ? (
                    <ChipList
                      compact
                      items={work.tags
                        .slice(0, 6)
                        .map((tag) => ({ label: tag.name }))}
                    />
                  ) : (
                    <span className="text-sm text-muted">未填写</span>
                  )}
                </td>
                <td>
                  {hasPermission(adminUser, "work.metadata.update_any") &&
                  (work.status !== "deleted" ||
                    hasPermission(adminUser, "work.status.update_any")) ? (
                    <Link
                      className={buttonVariants()}
                      to={`/admin/works/${work.id}`}
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
        <EmptyState title="没有找到匹配的作品。" />
      )}
      <PaginationLinks
        basePath="/admin/works"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          status: status === "all" ? undefined : status,
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
