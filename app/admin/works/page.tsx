import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import {
  AdminListControls,
  AdminPagination,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { searchEditableWorksForAdmin } from "@/lib/server/db/game-library";
import { formatNumber, formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminWorksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("/admin/works", "work.read_private");
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(searchParam(params.status), ["all", "published", "processing", "hidden"], "all");
  const sort = allowed(searchParam(params.sort), ["default", "title", "release"], "default");
  const page = parseAdminPage(params.page);
  const result = await searchEditableWorksForAdmin({
    query,
    status,
    sort: sort === "default" ? "id" : sort,
    page,
    pageSize: PAGE_SIZE,
  });

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
        ]}
        total={result.total}
      />

      {result.items.length > 0 ? <TableWrap compact label="作品列表" minWidth={980}>
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
                {work.chineseTitle ? <span className="text-sm text-muted">{work.originalTitle}</span> : null}
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
                    <span className="text-sm text-muted">{formatBytes(work.totalSizeBytes)}</span>
                  </>
                )}
              </td>
              <td>
                {work.tags.length > 0 ? (
                  <ChipList compact items={work.tags.slice(0, 6).map((tag) => ({ label: tag.name }))} />
                ) : (
                  <span className="text-sm text-muted">未填写</span>
                )}
              </td>
              <td>
                <Link className={buttonVariants()} href={`/admin/works/${work.id}`}>编辑</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap> : <EmptyState title="没有找到匹配的作品。" />}
      <AdminPagination
        basePath="/admin/works"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{ q: query || undefined, status: status === "all" ? undefined : status, sort: sort === "default" ? undefined : sort }}
      />
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}
