import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  listPublicCreators,
  type PublicCreatorSummary,
} from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

type CreatorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CreatorsPage({ searchParams }: CreatorsPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const currentUser = await getCurrentUserFromCookies();
  const [creators, unreadInboxCount] = await Promise.all([
    listPublicCreators({ query }),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Creators</p>
          <h1>作者与制作人员</h1>
          <p className="subtitle">
            浏览已入库作品关联到的作者、汉化者、校对、修图和整理人员。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/games">
            返回资料库
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
          ) : (
            <Link className="button" href="/login?next=/creators">
              登录
            </Link>
          )}
        </div>
      </header>

      <form className="library-toolbar" action="/creators" method="get">
        <label>
          <span>搜索</span>
          <input
            defaultValue={query}
            name="q"
            placeholder="作者名、原名"
            type="search"
          />
        </label>
        <button className="button primary" type="submit">
          筛选
        </button>
        {query ? (
          <Link className="button" href="/creators">
            清除
          </Link>
        ) : null}
      </form>

      <section className="library-summary" aria-label="作者摘要">
        <strong>{formatNumber(creators.length)}</strong>
        <span>位作者或制作人员符合当前条件</span>
      </section>

      {creators.length > 0 ? (
        <section className="creator-card-grid" aria-label="作者列表">
          {creators.map((creator) => (
            <CreatorCard creator={creator} key={creator.id} />
          ))}
        </section>
      ) : (
        <section className="card empty-card" style={{ marginTop: 16 }}>
          <h2>没有找到作者</h2>
          <p>调整关键词后再试。</p>
        </section>
      )}
    </main>
  );
}

function CreatorCard({ creator }: { creator: PublicCreatorSummary }) {
  return (
    <article className="creator-card">
      <div>
        <Link className="creator-card-title" href={`/creators/${creator.slug}`}>
          {creator.name}
        </Link>
        {creator.originalName ? (
          <span className="muted-line">{creator.originalName}</span>
        ) : null}
      </div>
      <p>{creator.bio || "暂无简介。"}</p>
      <dl className="game-card-stats">
        <div>
          <dt>作品</dt>
          <dd>{formatNumber(creator.workCreditCount)}</dd>
        </div>
        <div>
          <dt>发布</dt>
          <dd>{formatNumber(creator.releaseCreditCount)}</dd>
        </div>
      </dl>
    </article>
  );
}

function stringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
