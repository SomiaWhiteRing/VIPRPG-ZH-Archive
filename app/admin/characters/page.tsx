import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listCharactersForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber, formatUnreadCount } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminCharactersPage() {
  const adminUser = await requireAdminPageUser("/admin/characters");
  const [characters, unreadInboxCount] = await Promise.all([
    listCharactersForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Characters</p>
          <h1>登场角色维护</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/characters">
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

      <section className="table-wrap" aria-label="角色列表">
        <table className="data-table admin-creators-table">
          <thead>
            <tr>
              <th>角色</th>
              <th>登场作品</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((character) => (
              <tr key={character.id}>
                <td>
                  <strong>{character.primaryName}</strong>
                  {character.originalName ? (
                    <span className="muted-line">{character.originalName}</span>
                  ) : null}
                  <span className="mono muted-line">{character.slug}</span>
                </td>
                <td>{formatNumber(character.workCount)}</td>
                <td>{character.updatedAt}</td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/characters/${character.id}`}>
                      编辑
                    </Link>
                    {character.workCount > 0 ? (
                      <Link className="button" href={`/characters/${character.slug}`}>
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
