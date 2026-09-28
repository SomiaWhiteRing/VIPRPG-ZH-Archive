import { listCombinedTags } from "@/app/.server/db/user-work-tags";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { FilterLink, FilterSection, GameLibrary } from "@/app/components/library/game-library";
import { TagCloud } from "@/app/components/library/tag-cloud";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { normalizeEntityName } from "@/lib/entity-name";
import { stringParam } from "@/lib/params";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { TagSource } from "@/lib/user-tags";
import type { ReactNode } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  if (normalizeEntityName(stringParam(searchParams.tag))) {
    return { kind: "works" as const, data: await loadGameLibrary(runtime, searchParams) };
  }

  const query = normalizeEntityName(stringParam(searchParams.q));
  if (query) {
    const params = new URLSearchParams({ q: query, scope: "tags" });
    if (searchParams.page) params.set("page", stringParam(searchParams.page));
    throw redirect(`/search?${params}`);
  }
  return {
    kind: "tags" as const,
    tags: await listCombinedTags(runtime),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({
    title: loaderData?.kind === "works"
      ? `标签：${loaderData.data.selectedTag?.name ?? loaderData.data.tag}`
      : "标签",
    page: loaderData?.kind === "works" ? loaderData.data.page : undefined,
  }, error);

export default function TagsPage() {
  const result = useLoaderData<typeof loader>();
  if (result.kind === "works") {
    const { data } = result;
    return (
      <PageContainer>
        <GameLibrary
          data={data}
          basePath="/tags"
          title={`标签：${data.selectedTag?.name ?? data.tag}`}
          sidebar={(releaseFilter) => <TagSidebar source={data.tagSource} params={data.activeParams} releaseFilter={releaseFilter} />}
          showActiveFilters={false}
        />
      </PageContainer>
    );
  }

  const { tags } = result;
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="标签" />
      {tags.length > 0 ? <TagCloud tags={tags} /> : <EmptyState title="暂无标签。" />}
    </PageContainer>
  );
}

function TagSidebar({ source, params, releaseFilter }: {
  source: TagSource;
  params: Record<string, string | undefined>;
  releaseFilter: ReactNode;
}) {
  return (
    <>
      <FilterSection label="标签来源">
        {([['all', '全部'], ['public', '公共标签'], ['user', '作品标签']] as const).map(([value, label]) => {
          const search = new URLSearchParams();
          for (const [key, item] of Object.entries(params)) if (item) search.set(key, item);
          search.delete("page");
          search.delete("tag_source");
          if (value !== "all") search.set("tag_source", value);
          return <FilterLink key={value} active={source === value} href={`/tags?${search}`} label={label} />;
        })}
      </FilterSection>
      {releaseFilter}
      <FilterSection label="标签">
        <Link className="py-1.5 text-sm text-primary hover:underline" to="/tags">浏览全部标签</Link>
        <Link className="py-1.5 text-sm text-primary hover:underline" to="/games">返回作品库</Link>
      </FilterSection>
    </>
  );
}
