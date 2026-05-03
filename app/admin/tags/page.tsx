import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listTagsForAdmin } from "@/lib/server/db/taxonomy-library";

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
          <p className="subtitle">管理普通标签的命名空间、描述和重复标签合并。</p>
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
                  {formatNumber(tag.workCount)} 作品 / {formatNumber(tag.releaseCount)} Release
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

function namespaceLabel(value: string): string {
  const labels: Record<string, string> = {
    genre: "类型",
    theme: "主题",
    character: "角色相关",
    technical: "技术",
    content: "内容",
    other: "其他",
  };

  return labels[value] ?? value;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
