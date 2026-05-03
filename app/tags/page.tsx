import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listPublicTags, type PublicTagSummary } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type TagsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TagsPage({ searchParams }: TagsPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const currentUser = await getCurrentUserFromCookies();
  const [tags, unreadInboxCount] = await Promise.all([
    listPublicTags({ query }),
    currentUser ? countUnreadInboxItemsForUser(currentUser) : Promise.resolve(0),
  ]);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Tags</p>
          <h1>标签</h1>
          <p className="subtitle">普通检索标签与登场角色分开管理；角色请走登场角色页面。</p>
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
          ) : null}
        </div>
      </header>

      <form className="library-toolbar" action="/tags" method="get">
        <label>
          <span>搜索</span>
          <input defaultValue={query} name="q" placeholder="标签名、slug" type="search" />
        </label>
        <button className="button primary" type="submit">
          筛选
        </button>
        {query ? (
          <Link className="button" href="/tags">
            清除
          </Link>
        ) : null}
      </form>

      <section className="library-summary" aria-label="标签摘要">
        <strong>{formatNumber(tags.length)}</strong>
        <span>个标签符合当前条件</span>
      </section>

      {tags.length > 0 ? (
        <section className="creator-card-grid" aria-label="标签列表">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} />
          ))}
        </section>
      ) : (
        <section className="card empty-card" style={{ marginTop: 16 }}>
          <h2>没有找到标签</h2>
          <p>调整关键词后再试。</p>
        </section>
      )}
    </main>
  );
}

function TagCard({ tag }: { tag: PublicTagSummary }) {
  return (
    <article className="creator-card">
      <div>
        <Link className="creator-card-title" href={`/tags/${tag.slug}`}>
          {tag.name}
        </Link>
        <span className="mono muted-line">{tag.slug}</span>
      </div>
      <p>{tag.description || namespaceLabel(tag.namespace)}</p>
      <dl className="game-card-stats">
        <div>
          <dt>作品</dt>
          <dd>{formatNumber(tag.workCount)}</dd>
        </div>
        <div>
          <dt>Release</dt>
          <dd>{formatNumber(tag.releaseCount)}</dd>
        </div>
      </dl>
    </article>
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

function stringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
