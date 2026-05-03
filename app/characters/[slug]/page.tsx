import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getPublicCharacterDetail } from "@/lib/server/db/taxonomy-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

type CharacterDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function CharacterDetailPage({ params }: CharacterDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [character, unreadInboxCount] = await Promise.all([
    getPublicCharacterDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Character</p>
          <h1>{character.primaryName}</h1>
          {character.originalName ? <p className="subtitle">{character.originalName}</p> : null}
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/characters">
            返回角色列表
          </Link>
          <Link className="button" href={`/games?character=${encodeURIComponent(character.slug)}`}>
            筛选作品
          </Link>
          {currentUser ? (
            <Link className="button" href="/inbox">
              站内信
              {unreadInboxCount > 0 ? (
                <span className="notification-badge">
                  {formatUnreadCount(unreadInboxCount)}
                </span>
              ) : null}
            </Link>
          ) : null}
        </div>
      </header>

      <section className="section-grid creator-profile-grid" aria-label="角色资料">
        <section className="card">
          <h2>简介</h2>
          <p>{character.description || "暂无简介。"}</p>
        </section>
        <section className="card">
          <h2>关联统计</h2>
          <dl className="detail-list">
            <div>
              <dt>登场作品</dt>
              <dd>{formatNumber(character.workCount)}</dd>
            </div>
          </dl>
        </section>
      </section>

      <section className="creator-credit-section" aria-label="登场作品">
        <h2>登场作品</h2>
        {character.works.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table creator-credit-table">
              <thead>
                <tr>
                  <th>作品</th>
                  <th>引擎</th>
                  <th>归档</th>
                </tr>
              </thead>
              <tbody>
                {character.works.map((work) => (
                  <tr key={work.id}>
                    <td>
                      <Link href={`/games/${work.slug}`}>
                        {work.chineseTitle || work.originalTitle}
                      </Link>
                      {work.chineseTitle ? (
                        <span className="muted-line">{work.originalTitle}</span>
                      ) : null}
                    </td>
                    <td>{engineLabel(work.engineFamily)}</td>
                    <td>{formatNumber(work.archiveVersionCount)} 个归档</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">暂无公开登场作品。</p>
        )}
      </section>
    </main>
  );
}

function engineLabel(value: string): string {
  switch (value) {
    case "rpg_maker_2000":
      return "RPG Maker 2000";
    case "rpg_maker_2003":
      return "RPG Maker 2003";
    case "mixed":
      return "混合引擎";
    case "other":
      return "其他引擎";
    default:
      return "引擎未知";
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
