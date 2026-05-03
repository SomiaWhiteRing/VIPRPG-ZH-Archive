import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listSeriesForAdmin } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

export default async function AdminSeriesPage() {
  const adminUser = await requireAdminPageUser("/admin/series");
  const [series, unreadInboxCount] = await Promise.all([
    listSeriesForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Series</p>
          <h1>系列作品维护</h1>
          <p className="subtitle">创建和维护系列本体；作品加入系列在作品编辑页处理。</p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/series">
            公开列表
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

      <form
        action="/api/admin/series/create"
        className="card form-card stack-form"
        method="post"
      >
        <section className="form-section">
          <h2>新建系列</h2>
          <div className="upload-form-grid">
            <label className="field">
              系列名
              <input name="title" required />
            </label>
            <label className="field">
              原名
              <input name="title_original" />
            </label>
            <label className="field">
              Slug
              <input name="slug" placeholder="留空自动生成" />
            </label>
          </div>
        </section>
        <div className="actions">
          <button className="button primary" type="submit">
            创建系列
          </button>
        </div>
      </form>

      <section className="table-wrap admin-related-table" aria-label="系列列表">
        <table className="data-table admin-creators-table">
          <thead>
            <tr>
              <th>系列</th>
              <th>状态</th>
              <th>作品</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {series.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  {item.titleOriginal ? (
                    <span className="muted-line">{item.titleOriginal}</span>
                  ) : null}
                  <span className="mono muted-line">{item.slug}</span>
                </td>
                <td>
                  <span className={`badge ${statusBadgeClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td>{formatNumber(item.workCount)}</td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/series/${item.id}`}>
                      编辑
                    </Link>
                    {item.status === "published" ? (
                      <Link className="button" href={`/series/${item.slug}`}>
                        公开页
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

  if (value === "hidden" || value === "deleted") {
    return "rejected";
  }

  return "pending";
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
