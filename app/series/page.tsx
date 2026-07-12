import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
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
      <PageHeader eyebrow="Series" title="系列作品" />

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
        <section className="directory-card-grid" aria-label="系列列表">
          {series.map((item) => (
            <SeriesCard item={item} key={item.id} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的系列。" />
      )}
    </main>
  );
}

function SeriesCard({ item }: { item: PublicSeriesSummary }) {
  return (
    <article className="directory-card">
      <div>
        <Link className="directory-card-title" href={`/series/${item.slug}`}>
          {item.title}
        </Link>
        {item.titleOriginal ? <span className="muted-line">{item.titleOriginal}</span> : null}
      </div>
      {item.description ? <p>{item.description}</p> : null}
      <StatList
        columns={3}
        items={[{ label: "作品", value: formatNumber(item.workCount) }]}
        variant="tiles"
      />
    </article>
  );
}
