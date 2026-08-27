import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import { listPublicCreators, type PublicCreatorSummary } from "@/lib/server/db/creator-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";

type CreatorsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CreatorsPage({ searchParams }: CreatorsPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q);
  const creators = await listPublicCreators({ query });

  return (
    <main>
      <PageHeader title="作者与制作人员" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/creators"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input defaultValue={query} name="q" placeholder="作者名、原名" type="search" />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link className={buttonVariants({ variant: "outline" })} href="/creators">
            清除
          </Link>
        ) : null}
      </form>

      <section className="text-sm text-muted" aria-label="作者摘要">
        <strong>共 {formatNumber(creators.length)} </strong>
        <span>位作者或制作人员</span>
      </section>

      {creators.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="作者列表">
          {creators.map((creator) => (
            <CreatorCard creator={creator} key={creator.id} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的作者。" />
      )}
    </main>
  );
}

function CreatorCard({ creator }: { creator: PublicCreatorSummary }) {
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link className="text-lg font-bold text-primary hover:text-accent" href={`/creators/${creator.slug}`}>
          {creator.name}
        </Link>
        {creator.originalName ? <span className="text-sm text-muted">{creator.originalName}</span> : null}
      </div>
      {creator.bio ? <p>{creator.bio}</p> : null}
      <StatList
        columns={3}
        items={[
          { label: "作品", value: formatNumber(creator.workCreditCount) },
          { label: "参与游戏", value: formatNumber(creator.workCreditCount) },
        ]}
        variant="tiles"
      />
    </article>
  );
}
