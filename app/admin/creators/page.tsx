import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { listCreatorsForAdmin } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

export default async function AdminCreatorsPage() {
  const adminUser = await requireAdminPageUser("/admin/creators");
  const [creators, unreadInboxCount] = await Promise.all([
    listCreatorsForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Creators</p>
          <h1>作者与制作人员维护</h1>
          <p className="subtitle">
            这里维护 creator 本体资料。作品和 Release 的职务关联来自导入数据，第一版先作为只读年表展示。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/creators">
            查看公开列表
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

      <section className="table-wrap" aria-label="作者列表">
        <table className="data-table admin-creators-table">
          <thead>
            <tr>
              <th>作者</th>
              <th>关联</th>
              <th>链接</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {creators.map((creator) => (
              <tr key={creator.id}>
                <td>
                  <strong>{creator.name}</strong>
                  {creator.originalName ? (
                    <span className="muted-line">{creator.originalName}</span>
                  ) : null}
                  <span className="mono muted-line">{creator.slug}</span>
                </td>
                <td>
                  {formatNumber(creator.workCreditCount)} 作品 /{" "}
                  {formatNumber(creator.releaseCreditCount)} Release
                  {creator.latestReleaseCreditAt ? (
                    <span className="muted-line">
                      最近关联：{creator.latestReleaseCreditAt}
                    </span>
                  ) : null}
                </td>
                <td>
                  {creator.websiteUrl ? (
                    <a href={creator.websiteUrl} rel="noreferrer" target="_blank">
                      个人链接
                    </a>
                  ) : (
                    <span className="muted-line">未填写</span>
                  )}
                </td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/creators/${creator.id}`}>
                      编辑
                    </Link>
                    <Link className="button" href={`/creators/${creator.slug}`}>
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

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
