import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getPublicCreatorDetail } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

type CreatorDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function CreatorDetailPage({ params }: CreatorDetailPageProps) {
  const { slug } = await params;
  const currentUser = await getCurrentUserFromCookies();
  const [creator, unreadInboxCount] = await Promise.all([
    getPublicCreatorDetail(slug),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  if (!creator) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Creator</p>
          <h1>{creator.name}</h1>
          {creator.originalName ? <p className="subtitle">{creator.originalName}</p> : null}
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/creators">
            返回作者列表
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

      <section className="section-grid creator-profile-grid" aria-label="作者资料">
        <section className="card">
          <h2>简介</h2>
          <p>{creator.bio || "暂无简介。"}</p>
          {creator.websiteUrl ? (
            <div className="actions">
              <a className="button" href={creator.websiteUrl} rel="noreferrer" target="_blank">
                个人链接
              </a>
            </div>
          ) : null}
        </section>
        <section className="card">
          <h2>关联统计</h2>
          <dl className="detail-list">
            <div>
              <dt>作品层职务</dt>
              <dd>{formatNumber(creator.workCreditCount)}</dd>
            </div>
            <div>
              <dt>发布版本职务</dt>
              <dd>{formatNumber(creator.releaseCreditCount)}</dd>
            </div>
            <div>
              <dt>最近发布关联</dt>
              <dd>{creator.latestReleaseCreditAt ?? "暂无"}</dd>
            </div>
          </dl>
        </section>
      </section>

      <section className="creator-credit-section" aria-label="作品年表">
        <h2>作品年表</h2>
        {creator.workCredits.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table creator-credit-table">
              <thead>
                <tr>
                  <th>作品</th>
                  <th>职务</th>
                  <th>日期</th>
                </tr>
              </thead>
              <tbody>
                {creator.workCredits.map((credit) => (
                  <tr key={`${credit.workId}-${credit.roleKey}`}>
                    <td>
                      <Link href={`/games/${credit.workSlug}`}>{credit.workTitle}</Link>
                      {credit.workTitle !== credit.workOriginalTitle ? (
                        <span className="muted-line">{credit.workOriginalTitle}</span>
                      ) : null}
                    </td>
                    <td>
                      {credit.roleLabel || creatorRoleLabel(credit.roleKey)}
                      {credit.notes ? <span className="muted-line">{credit.notes}</span> : null}
                    </td>
                    <td>{credit.originalReleaseDate ?? "未知"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">暂无作品层职务记录。</p>
        )}
      </section>

      <section className="creator-credit-section" aria-label="发布参与">
        <h2>发布参与</h2>
        {creator.releaseCredits.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table creator-credit-table">
              <thead>
                <tr>
                  <th>作品 / Release</th>
                  <th>职务</th>
                  <th>日期</th>
                </tr>
              </thead>
              <tbody>
                {creator.releaseCredits.map((credit) => (
                  <tr key={`${credit.releaseId}-${credit.roleKey}`}>
                    <td>
                      <Link href={`/games/${credit.workSlug}`}>{credit.workTitle}</Link>
                      <span className="muted-line">{credit.releaseLabel}</span>
                    </td>
                    <td>
                      {credit.roleLabel || creatorRoleLabel(credit.roleKey)}
                      {credit.notes ? <span className="muted-line">{credit.notes}</span> : null}
                    </td>
                    <td>{credit.releaseDate ?? "未知"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">暂无发布版本职务记录。</p>
        )}
      </section>
    </main>
  );
}

function creatorRoleLabel(value: string): string {
  const labels: Record<string, string> = {
    author: "作者",
    scenario: "剧本",
    graphics: "图像",
    music: "音乐",
    translator: "翻译",
    proofreader: "校对",
    image_editor: "修图",
    publisher: "发布",
    repacker: "整理",
    editor: "编辑",
  };

  return labels[value] ?? value;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
