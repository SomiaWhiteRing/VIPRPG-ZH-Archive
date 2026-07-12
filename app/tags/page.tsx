import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
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
      <PageHeader eyebrow="Tags" title="标签" />

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
        <section className="directory-card-grid" aria-label="标签列表">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的标签。" />
      )}
    </main>
  );
}

function TagCard({ tag }: { tag: PublicTagSummary }) {
  return (
    <article className="directory-card">
      <div>
        <Link className="directory-card-title" href={`/tags/${tag.slug}`}>
          {tag.name}
        </Link>
        <span className="mono muted-line">{tag.slug}</span>
      </div>
      <p>{tag.description || namespaceLabel(tag.namespace)}</p>
      <StatList
        columns={3}
        items={[
          { label: "作品", value: formatNumber(tag.workCount) },
          { label: "发布版本", value: formatNumber(tag.releaseCount) },
        ]}
        variant="tiles"
      />
    </article>
  );
}
