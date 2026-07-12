import Link from "next/link";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Creators</p>
          <h1>作者与制作人员</h1>
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
        <section className="card empty-card">
          <h2>没有找到匹配的作者。</h2>
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
      {creator.bio ? <p>{creator.bio}</p> : null}
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
