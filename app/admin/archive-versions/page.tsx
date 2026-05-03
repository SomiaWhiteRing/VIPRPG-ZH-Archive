import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive Maintenance</p>
          <h1>归档快照维护</h1>
          <p className="subtitle">
            {canAccessTrash
              ? "删除会把 ArchiveVersion 放入回收站，不会立即删除 R2 对象。回收站内的版本可以还原；超过保留期并被最终清理后才会失去还原能力。"
              : "这里列出你上传的归档快照。删除会把归档放入回收站，需要管理员在回收站中还原。"}
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

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
