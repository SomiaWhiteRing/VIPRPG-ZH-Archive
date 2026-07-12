import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listCharactersForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminCharactersPage() {
  const adminUser = await requireAdminPageUser("/admin/characters");
  const [characters, unreadInboxCount] = await Promise.all([
    listCharactersForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Characters"
        title="登场角色维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className="button" href="/characters">
              公开列表
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <TableWrap label="角色列表" minWidth={900}>
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
      </TableWrap>
    </main>
  );
}
