import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import { listPublicSeries, type PublicSeriesSummary } from "@/lib/server/db/taxonomy-library";
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
      <PageHeader title="系列作品" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/series"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input defaultValue={query} name="q" placeholder="系列名、原名、slug" type="search" />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link className={buttonVariants({ variant: "outline" })} href="/series">
            清除
          </Link>
        ) : null}
      </form>

      <section className="text-sm text-muted" aria-label="系列摘要">
        <strong>共 {formatNumber(series.length)} </strong>
        <span>个系列</span>
      </section>

      {series.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="系列列表">
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
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link className="text-lg font-bold text-primary hover:text-accent" href={`/series/${item.slug}`}>
          {item.title}
        </Link>
        {item.titleOriginal ? <span className="text-sm text-muted">{item.titleOriginal}</span> : null}
      </div>
      {item.description ? <p>{item.description}</p> : null}
      <StatList columns={3} items={[{ label: "作品", value: formatNumber(item.workCount) }]} variant="tiles" />
    </article>
  );
}
