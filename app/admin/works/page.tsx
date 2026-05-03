import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { listEditableWorksForAdmin } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

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
          <p className="subtitle">
            这里维护作品层的基础资料：中文名、简介、别名、标签、外部链接、引擎和在线游玩兼容标记。
          </p>
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
                  <span className={`badge ${statusBadgeClass(work.status)}`}>
                    {statusLabel(work.status)}
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

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function statusLabel(value: string): string {
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "draft":
      return "草稿";
    case "deleted":
      return "已删除";
    default:
      return value;
  }
}

function statusBadgeClass(value: string): string {
  if (value === "published") {
    return "approved";
  }

  if (value === "deleted" || value === "hidden") {
    return "rejected";
  }

  return "pending";
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
