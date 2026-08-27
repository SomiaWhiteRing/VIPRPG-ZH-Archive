import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
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
      <PageHeader title="标签" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/tags"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input defaultValue={query} name="q" placeholder="标签名" type="search" />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link className={buttonVariants({ variant: "outline" })} href="/tags">
            清除
          </Link>
        ) : null}
      </form>

      <section className="text-sm text-muted" aria-label="标签摘要">
        <span>共</span>
        <strong>{formatNumber(tags.length)}</strong>
        <span>个标签</span>
      </section>

      {tags.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="标签列表">
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
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link
          className="text-lg font-bold text-primary hover:text-accent"
          href={`/games?tag=${tag.id}`}
        >
          {tag.name}
        </Link>
      </div>
      <p>{tag.description || namespaceLabel(tag.namespace)}</p>
      <StatList
        columns={3}
        items={[
          { label: "作品", value: formatNumber(tag.workCount) },
          { label: "游戏", value: formatNumber(tag.workCount) },
        ]}
        variant="tiles"
      />
    </article>
  );
}
