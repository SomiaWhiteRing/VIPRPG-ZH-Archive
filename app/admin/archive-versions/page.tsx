import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { hasPermission } from "@/lib/authz/permissions";
import { searchArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminArchiveVersionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const adminUser = await requirePagePermission("/admin/archive-versions", "archive_version.read_private");
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(searchParam(params.status), ["all", "published", "processing", "hidden"], "all");
  const sort = allowed(searchParam(params.sort), ["default", "size"], "default");
  const page = parseAdminPage(params.page);
  const result = await searchArchiveVersionsForAdmin({ actor: adminUser, filter: "active", query, status, sort, page, pageSize: PAGE_SIZE });
  const canAccessTrash = hasPermission(adminUser, "archive_version.restore");

  return (
    <main>
      <PageHeader
        compact
        title="文件版本维护"
        subtitle={
          canAccessTrash
            ? "删除的文件版本会移入回收站，最终清理后无法还原。"
            : "删除的文件版本会移入回收站，还原需联系管理员。"
        }
        actions={
          canAccessTrash ? <Link className={buttonVariants({ variant: "outline" })} href="/admin/archive-versions/trash">查看回收站</Link> : null
        }
      />
      <AdminListControls
        action="/admin/archive-versions"
        noun="文件版本"
        query={query}
        sort={sort}
        sortOptions={[{ value: "default", label: "最近创建" }, { value: "size", label: "容量" }]}
        status={status}
        statusOptions={[
          { value: "all", label: "全部状态" },
          { value: "published", label: "已发布" },
          { value: "processing", label: "处理中" },
          { value: "hidden", label: "隐藏" },
        ]}
        total={result.total}
      />
      <ArchiveVersionTable actor={adminUser} archiveVersions={result.items} mode="active" />
      <PaginationLinks
        basePath="/admin/archive-versions"
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
