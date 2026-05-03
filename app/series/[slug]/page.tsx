import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getPublicSeriesDetail } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type SeriesDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function SeriesDetailPage({ params }: SeriesDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [series, unreadInboxCount] = await Promise.all([
    getPublicSeriesDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!series) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Series</p>
          <h1>{series.title}</h1>
          {series.titleOriginal ? <p className="subtitle">{series.titleOriginal}</p> : null}
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/series">
            返回系列列表
          </Link>
          <Link className="button" href="/games">
            游戏资料库
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

      <section className="card" style={{ marginTop: 16 }}>
        <h2>简介</h2>
        <p>{series.description || "暂无简介。"}</p>
      </section>

      <section className="creator-credit-section" aria-label="系列作品">
        <h2>系列作品</h2>
        {series.works.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table creator-credit-table">
              <thead>
                <tr>
                  <th>顺序</th>
                  <th>作品</th>
                  <th>关系</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {series.works.map((work) => (
                  <tr key={work.workId}>
                    <td>{work.positionLabel || work.positionNumber || "-"}</td>
                    <td>
                      <Link href={`/games/${work.slug}`}>{work.title}</Link>
                      {work.title !== work.originalTitle ? (
                        <span className="muted-line">{work.originalTitle}</span>
                      ) : null}
                    </td>
                    <td>{seriesRelationLabel(work.relationKind)}</td>
                    <td>{work.notes || "无"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">暂无公开系列作品。</p>
        )}
      </section>
    </main>
  );
}

function seriesRelationLabel(value: string): string {
  const labels: Record<string, string> = {
    main: "正篇",
    side: "外传",
    collection_member: "合集成员",
    same_setting: "同世界观",
    other: "其他",
  };

  return labels[value] ?? value;
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
