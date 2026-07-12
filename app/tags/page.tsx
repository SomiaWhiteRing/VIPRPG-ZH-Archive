import Link from "next/link";
import { listPublicTags, type PublicTagSummary } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";

type TagsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TagsPage({ searchParams }: TagsPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const tags = await listPublicTags({ query });

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Tags</p>
          <h1>标签</h1>
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
        <span>共</span>
        <strong>{formatNumber(tags.length)}</strong>
        <span>个标签</span>
      </section>

      {tags.length > 0 ? (
        <section className="creator-card-grid" aria-label="标签列表">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} />
          ))}
        </section>
      ) : (
        <section className="card empty-card">
          <h2>没有找到匹配的标签。</h2>
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
          <dt>发布版本</dt>
          <dd>{formatNumber(tag.releaseCount)}</dd>
        </div>
      </dl>
    </article>
  );
}
