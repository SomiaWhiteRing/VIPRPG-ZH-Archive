import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import {
  listPublicCreators,
  type PublicCreatorSummary,
} from "@/lib/server/db/creator-library";
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
      <PageHeader eyebrow="Creators" title="作者与制作人员" />

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
        <strong>共 {formatNumber(creators.length)} </strong>
        <span>位作者或制作人员</span>
      </section>

      {creators.length > 0 ? (
        <section className="creator-card-grid" aria-label="作者列表">
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
    <article className="creator-card">
      <div>
        <Link className="creator-card-title" href={`/creators/${creator.slug}`}>
          {creator.name}
        </Link>
        {creator.originalName ? (
          <span className="muted-line">{creator.originalName}</span>
        ) : null}
      </div>
      {creator.bio ? <p>{creator.bio}</p> : null}
      <StatList
        columns={3}
        items={[
          { label: "作品", value: formatNumber(creator.workCreditCount) },
          { label: "发布", value: formatNumber(creator.releaseCreditCount) },
        ]}
        variant="tiles"
      />
    </article>
  );
}
