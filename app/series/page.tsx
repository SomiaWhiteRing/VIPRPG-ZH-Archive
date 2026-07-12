import Link from "next/link";
import {
  listPublicSeries,
  type PublicSeriesSummary,
} from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";

type SeriesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SeriesPage({ searchParams }: SeriesPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const series = await listPublicSeries({ query });

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Series</p>
          <h1>系列作品</h1>
        </div>
      </header>

      <form className="library-toolbar" action="/series" method="get">
        <label>
          <span>搜索</span>
          <input defaultValue={query} name="q" placeholder="系列名、原名、slug" type="search" />
        </label>
        <button className="button primary" type="submit">
          筛选
        </button>
        {query ? (
          <Link className="button" href="/series">
            清除
          </Link>
        ) : null}
      </form>

      <section className="library-summary" aria-label="系列摘要">
        <strong>共 {formatNumber(series.length)} </strong>
        <span>个系列</span>
      </section>

      {series.length > 0 ? (
        <section className="creator-card-grid" aria-label="系列列表">
          {series.map((item) => (
            <SeriesCard item={item} key={item.id} />
          ))}
        </section>
      ) : (
        <section className="card empty-card">
          <h2>没有找到匹配的系列。</h2>
        </section>
      )}
    </main>
  );
}

function SeriesCard({ item }: { item: PublicSeriesSummary }) {
  return (
    <article className="creator-card">
      <div>
        <Link className="creator-card-title" href={`/series/${item.slug}`}>
          {item.title}
        </Link>
        {item.titleOriginal ? <span className="muted-line">{item.titleOriginal}</span> : null}
      </div>
      {item.description ? <p>{item.description}</p> : null}
      <dl className="game-card-stats">
        <div>
          <dt>作品</dt>
          <dd>{formatNumber(item.workCount)}</dd>
        </div>
      </dl>
    </article>
  );
}
