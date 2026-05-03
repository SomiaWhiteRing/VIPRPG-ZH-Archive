import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getPublicTagDetail } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type TagDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function TagDetailPage({ params }: TagDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [tag, unreadInboxCount] = await Promise.all([
    getPublicTagDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!tag) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Tag</p>
          <h1>{tag.name}</h1>
          <p className="subtitle">{tag.description || namespaceLabel(tag.namespace)}</p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/tags">
            返回标签列表
          </Link>
          <Link className="button" href={`/games?tag=${encodeURIComponent(tag.slug)}`}>
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

      <section className="creator-credit-section" aria-label="标签作品">
        <h2>关联作品</h2>
        {tag.works.length > 0 ? (
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
                {tag.works.map((work) => (
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
          <p className="muted-line">暂无公开关联作品。</p>
        )}
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
