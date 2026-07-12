import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listTagsForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber, formatUnreadCount } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const adminUser = await requireAdminPageUser("/admin/tags");
  const [tags, unreadInboxCount] = await Promise.all([
    listTagsForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Tags</p>
          <h1>标签维护</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/tags">
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

      <section className="table-wrap" aria-label="标签列表">
        <table className="data-table admin-creators-table">
          <thead>
            <tr>
              <th>标签</th>
              <th>命名空间</th>
              <th>关联</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td>
                  <strong>{tag.name}</strong>
                  <span className="mono muted-line">{tag.slug}</span>
                </td>
                <td>{namespaceLabel(tag.namespace)}</td>
                <td>
                  {formatNumber(tag.workCount)} 作品 / {formatNumber(tag.releaseCount)} 发布版本
                </td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/tags/${tag.id}`}>
                      编辑
                    </Link>
                    <Link className="button" href={`/tags/${tag.slug}`}>
                      公开页
                    </Link>
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
