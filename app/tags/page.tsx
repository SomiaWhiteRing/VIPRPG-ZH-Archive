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
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { TagSource } from "@/lib/user-tags";
import type { ReactNode } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { useMessages } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  if (normalizeEntityName(stringParam(searchParams.tag))) {
    return { kind: "works" as const, data: await loadGameLibrary(runtime, searchParams), locale: runtime.uiLocale };
  }

  const query = normalizeEntityName(stringParam(searchParams.q));
  if (query) {
    const params = new URLSearchParams({ q: query, scope: "tags" });
    if (searchParams.page) params.set("page", stringParam(searchParams.page));
    const source = new URL(args.request.url);
    const target = preserveUiLocale(new URL(`/search?${params}`, source), source);
    throw redirect(target.pathname + target.search);
  }
  return {
    kind: "tags" as const,
    locale: runtime.uiLocale,
    tags: await listCombinedTags(runtime),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: loaderData?.kind === "works"
      ? translate(locale, "tags.ui.selected", { name: loaderData.data.selectedTag?.name ?? loaderData.data.tag })
      : translate(locale, "library.tags"),
    page: loaderData?.kind === "works" ? loaderData.data.page : undefined,
  }, error, locale);
};

export default function TagsPage() {
  const t = useMessages();
  const result = useLoaderData<typeof loader>();
  if (result.kind === "works") {
    const { data } = result;
    return (
      <PageContainer>
        <GameLibrary
          data={data}
          basePath="/tags"
          title={t("tags.ui.selected", { name: data.selectedTag?.name ?? data.tag })}
          sidebar={(releaseFilter) => <TagSidebar source={data.tagSource} params={data.activeParams} releaseFilter={releaseFilter} />}
          showActiveFilters={false}
        />
      </PageContainer>
    );
  }

  const { tags } = result;
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title={t("library.tags")} />
      {tags.length > 0 ? <TagCloud tags={tags} /> : <EmptyState title={t("tags.ui.empty")} />}
    </PageContainer>
  );
}

function TagSidebar({ source, params, releaseFilter }: {
  source: TagSource;
  params: Record<string, string | undefined>;
  releaseFilter: ReactNode;
}) {
  const t = useMessages();
  return (
    <>
      <FilterSection label={t("tags.ui.source")}>
        {(["all", "public", "user"] as const).map((value) => {
          const search = new URLSearchParams();
          for (const [key, item] of Object.entries(params)) if (item) search.set(key, item);
          search.delete("page");
          search.delete("tag_source");
          if (value !== "all") search.set("tag_source", value);
          return <FilterLink key={value} active={source === value} href={`/tags?${search}`} label={t(value === "all" ? "timeline.feed.allKinds" : `tags.ui.${value}`)} />;
        })}
      </FilterSection>
      {releaseFilter}
      <FilterSection label={t("library.tags")}>
        <Link className="py-1.5 text-sm text-primary hover:underline" to="/tags">{t("tags.ui.all")}</Link>
        <Link className="py-1.5 text-sm text-primary hover:underline" to="/games">{t("tags.ui.library")}</Link>
      </FilterSection>
    </>
  );
}
