import Link from "next/link";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { listArchiveVersionsForAdmin } from "@/lib/server/db/archive-maintenance";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

export default async function AdminArchiveVersionTrashPage() {
  const adminUser = await requireAdminPageUser("/admin/archive-versions/trash");
  const [archiveVersions, unreadInboxCount] = await Promise.all([
    listArchiveVersionsForAdmin(150, "trash"),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive Trash</p>
          <h1>归档回收站</h1>
          <p className="subtitle">
            这里列出已删除但尚未最终清理的 ArchiveVersion。还原后会重新发布；
            如果同组没有当前版本，系统会自动把它设为当前版本。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/archive-versions">
            返回归档维护
          </Link>
          <Link className="button" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={archiveVersions}
        mode="trash"
      />
    </main>
  );
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
