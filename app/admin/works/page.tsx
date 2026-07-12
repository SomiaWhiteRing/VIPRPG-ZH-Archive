import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { listEditableWorksForAdmin } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatUnreadCount, formatNumber, formatBytes } from "@/lib/format";
import { workStatusBadgeClass, workStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminWorksPage() {
  const adminUser = await requireAdminPageUser("/admin/works");
  const [works, unreadInboxCount] = await Promise.all([
    listEditableWorksForAdmin(200),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Works</p>
          <h1>作品资料维护</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
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

      <section className="table-wrap" aria-label="作品列表">
        <table className="data-table admin-works-table">
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
            {works.map((work) => (
              <tr key={work.id}>
                <td>
                  <strong>{work.chineseTitle || work.originalTitle}</strong>
                  {work.chineseTitle ? (
                    <span className="muted-line">{work.originalTitle}</span>
                  ) : null}
                  <span className="mono muted-line">{work.slug}</span>
                </td>
                <td>
                  <span className={`badge ${workStatusBadgeClass(work.status)}`}>
                    {workStatusLabel(work.status)}
                  </span>
                  {work.usesManiacsPatch ? (
                    <span className="muted-line">Maniacs Patch</span>
                  ) : null}
                </td>
                <td>
                  {formatNumber(work.releaseCount)} 发布 /{" "}
                  {formatNumber(work.archiveVersionCount)} 归档
                  <span className="muted-line">{formatBytes(work.totalSizeBytes)}</span>
                </td>
                <td>
                  {work.tags.length > 0 ? (
                    <div className="chip-list compact-chip-list">
                      {work.tags.slice(0, 6).map((tag) => (
                        <span key={tag.slug}>{tag.name}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted-line">未填写</span>
                  )}
                </td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/works/${work.id}`}>
                      编辑
                    </Link>
                    {work.status === "published" ? (
                      <Link className="button" href={`/games/${work.slug}`}>
                        查看公开页
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
