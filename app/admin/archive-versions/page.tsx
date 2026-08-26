import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { hasPermission } from "@/lib/authz/permissions";
import { listArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

export default async function AdminArchiveVersionsPage() {
  const adminUser = await requirePagePermission("/admin/archive-versions", "archive_version.read_private");
  const [archiveVersions, unreadInboxCount] = await Promise.all([
    listArchiveVersionsForAdmin(150, "active", adminUser),
    countUnreadInboxItemsForUser(adminUser),
  ]);
  const canAccessTrash = hasPermission(adminUser, "archive_version.restore");

  return (
    <main>
      <PageHeader
        title="文件版本维护"
        subtitle={
          canAccessTrash
            ? "删除的文件版本会移入回收站，最终清理后无法还原。"
            : "删除的文件版本会移入回收站，还原需联系管理员。"
        }
        actions={
          <>
            {canAccessTrash ? <BackLink href="/admin" label="返回管理端" /> : <BackLink href="/" label="返回首页" />}
            {canAccessTrash ? (
              <Link className={buttonVariants()} href="/admin/archive-versions/trash">
                查看回收站
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <ArchiveVersionTable actor={adminUser} archiveVersions={archiveVersions} mode="active" />
    </main>
  );
}
