import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { listArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";

export const dynamic = "force-dynamic";

export default async function AdminArchiveVersionTrashPage() {
  const adminUser = await requirePagePermission("/admin/archive-versions/trash", "archive_version.restore");
  const archiveVersions = await listArchiveVersionsForAdmin(150, "trash", adminUser);

  return (
    <main>
      <PageHeader
        title="已删除版本"
        subtitle="还原后会重新发布；同组没有最新快照时，会自动成为最新快照。"
        actions={
          <BackLink href="/admin/archive-versions" label="返回版本管理" />
        }
      />

      <ArchiveVersionTable actor={adminUser} archiveVersions={archiveVersions} mode="trash" />
    </main>
  );
}
