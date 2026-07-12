import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requireUploaderPageUser } from "@/lib/server/auth/guards";
import { canManageUsersRole } from "@/lib/server/auth/roles";
import { listArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

export default async function AdminArchiveVersionsPage() {
  const adminUser = await requireUploaderPageUser("/admin/archive-versions");
  const [archiveVersions, unreadInboxCount] = await Promise.all([
    listArchiveVersionsForAdmin(150, "active", adminUser),
    countUnreadInboxItemsForUser(adminUser),
  ]);
  const canAccessTrash = canManageUsersRole(adminUser.role);

  return (
    <main>
      <PageHeader
        eyebrow="Archive Maintenance"
        title="归档快照维护"
        subtitle={
          canAccessTrash
            ? "删除的归档快照会移入回收站，最终清理后无法还原。"
            : "删除的归档快照会移入回收站，还原需联系管理员。"
        }
        actions={
          <>
            {canAccessTrash ? (
              <BackLink href="/admin" label="返回管理端" />
            ) : (
              <BackLink href="/" label="返回首页" />
            )}
            {canAccessTrash ? (
              <Link className="button primary" href="/admin/archive-versions/trash">
                查看回收站
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={archiveVersions}
        mode="active"
      />
    </main>
  );
}
