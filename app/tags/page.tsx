import { listPublicTags } from "@/app/.server/db/taxonomy-library";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatList } from "@/app/components/ui/stat-list";
import type { PublicTagSummary } from "@/lib/dto/db/taxonomy-library";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";
import { stringParam } from "@/lib/params";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q);
  const tags = await listPublicTags(runtime, { query });

  return { query, tags };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: loaderData?.query
        ? [`“${loaderData.query}”的搜索结果`, "标签"]
        : "标签",
    },
    error,
  );

export default function TagsPage() {
  const { query, tags } = useLoaderData<typeof loader>();
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="标签" />

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        action="/tags"
        method="get"
      >
        <Label>
          <span>搜索</span>
          <Input
            defaultValue={query}
            name="q"
            placeholder="标签名"
            type="search"
          />
        </Label>
        <Button type="submit">筛选</Button>
        {query ? (
          <Link className={buttonVariants({ variant: "outline" })} to="/tags">
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
        <section
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          aria-label="标签列表"
        >
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的标签。" />
      )}
    </PageContainer>
  );
}

function TagCard({ tag }: { tag: PublicTagSummary }) {
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <Link
          className="text-lg font-bold text-primary hover:text-accent"
          to={`/games?tag=${tag.id}`}
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
