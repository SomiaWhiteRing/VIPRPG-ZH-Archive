import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { requireUploaderPageUser } from "@/lib/server/auth/guards";
import { canManageUsersRole } from "@/lib/server/auth/roles";
import { listArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatUnreadCount } from "@/lib/format";

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
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive Maintenance</p>
          <h1>归档快照维护</h1>
          <p className="subtitle">
            {canAccessTrash
              ? "删除的归档快照会移入回收站，最终清理后无法还原。"
              : "删除的归档快照会移入回收站，还原需联系管理员。"}
          </p>
        </div>
        <div className="actions header-actions">
          {canAccessTrash ? (
            <>
              <Link className="button primary" href="/admin/archive-versions/trash">
                查看回收站
              </Link>
              <Link className="button" href="/admin">
                返回管理端
              </Link>
            </>
          ) : null}
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
          <Link className="button" href="/">
            返回首页
          </Link>
        </div>
      </header>

      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={archiveVersions}
        mode="active"
      />
    </main>
  );
}
