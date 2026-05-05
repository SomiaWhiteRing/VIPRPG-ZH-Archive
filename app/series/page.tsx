import Link from "next/link";
import {
  listPublicSeries,
  type PublicSeriesSummary,
} from "@/lib/server/db/taxonomy-library";

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
          <p className="subtitle">按系列统一查看正篇、外传、同合集作品和排序信息。</p>
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
        <strong>{formatNumber(series.length)}</strong>
        <span>个系列符合当前条件</span>
      </section>

      {series.length > 0 ? (
        <section className="creator-card-grid" aria-label="系列列表">
          {series.map((item) => (
            <SeriesCard item={item} key={item.id} />
          ))}
        </section>
      ) : (
        <section className="card empty-card" style={{ marginTop: 16 }}>
          <h2>没有找到系列</h2>
          <p>调整关键词后再试。</p>
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
      <p>{item.description || "暂无简介。"}</p>
      <dl className="game-card-stats">
        <div>
          <dt>作品</dt>
          <dd>{formatNumber(item.workCount)}</dd>
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
