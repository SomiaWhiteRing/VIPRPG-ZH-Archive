import { searchCatalogs } from "@/app/.server/db/catalogs";
import { readCharacterCounts } from "@/app/.server/db/character-index";
import { listPublicCreators } from "@/app/.server/db/creator-library";
import { searchGameWorks } from "@/app/.server/db/game-library";
import {
  listPublicTags,
  searchPublicCharacters,
} from "@/app/.server/db/taxonomy-library";
import { loadDiscussionSearch } from "@/app/.server/forum/search-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { AppRuntime } from "@/app/.server/runtime";
import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { CharacterCard } from "@/app/components/characters/character-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { SearchResultRow } from "@/app/components/search/search-result-row";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { DiscussionSearchResults } from "@/app/discussions/search/results";
import type { CharacterIndexEntry } from "@/lib/character-index";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { formatNumber } from "@/lib/format";
import { FORUM_SEARCH_QUERY_LENGTH } from "@/lib/forum-search-index";
import { stringParam } from "@/lib/params";
import { getSearchScope, SEARCH_SCOPES } from "@/lib/search";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const [scope, scopeLabel] = getSearchScope(stringParam(params.scope));
  const page = Math.max(
    1,
    Number.parseInt(stringParam(params.page) || "1", 10) || 1,
  );
  const result =
    query && scope === "works"
      ? await searchGameWorks(runtime, { query, page })
      : null;
  const directory =
    query && scope !== "works" && scope !== "discussions"
      ? await listDirectory(runtime, scope, query, page)
      : null;

  const discussions =
    scope === "discussions"
      ? await loadDiscussionSearch(runtime, { params })
      : null;
  return {
    discussions,
    params,
    query,
    scope,
    page,
    scopeLabel,
    result,
    directory,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: loaderData?.query
        ? [`“${loaderData.query}”的搜索结果`, loaderData.scopeLabel]
        : "站内搜索",
      page:
        loaderData?.discussions?.result.page ?? (loaderData?.query ? loaderData.page : undefined),
    },
    error,
  );

export default function SearchPage() {
  const { discussions, query, scope, page, scopeLabel, result, directory } =
    useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader compact title="搜索站内内容" />
      <Form
        key={`${scope}:${query}`}
        className="my-6 flex gap-2"
        action="/search"
      >
        <Label className="sr-only" htmlFor="search-query">
          搜索关键词
        </Label>
        <Input
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          id="search-query"
          name="q"
          defaultValue={query}
          placeholder="输入关键词"
          type="search"
          maxLength={
            scope === "discussions" ? FORUM_SEARCH_QUERY_LENGTH : undefined
          }
        />
        <input name="scope" type="hidden" value={scope} />
        <Rm2kButton type="submit">搜索</Rm2kButton>
      </Form>
      <nav
        className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm font-bold"
        aria-label="搜索范围"
      >
        {SEARCH_SCOPES.map(([value, label]) => (
          <Link
            className={
              scope === value
                ? "text-primary underline decoration-2 underline-offset-4"
                : undefined
            }
            to={searchHref(query, value)}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>
      {scope === "discussions" ? (
        discussions && <DiscussionSearchResults {...discussions} />
      ) : !query ? null : result ? (
        <>
          <p className="my-6 text-sm text-muted">
            “{query}”在{scopeLabel}中找到 {formatNumber(result.total)} 个结果
          </p>
          {result.items.length > 0 ? (
            <section className="grid gap-2.5" aria-label="作品搜索结果">
              {result.items.map((work) => (
                <SearchResultRow key={work.id} work={work} />
              ))}
            </section>
          ) : (
            <EmptyState title="没有找到匹配的作品。" />
          )}
          <PaginationLinks
            basePath="/search"
            page={page}
            pageSize={result.pageSize}
            params={{ q: query, scope }}
            total={result.total}
          />
        </>
      ) : (
        <>
          <p className="my-6 text-sm text-muted">
            “{query}”在{scopeLabel}中找到 {formatNumber(directory?.total ?? 0)}{" "}
            个结果
          </p>
          {directory && directory.items.length > 0 ? (
            <section
              className={
                scope === "characters"
                  ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  : scope === "catalogs"
                    ? "divide-y divide-border border-y border-border"
                    : "grid gap-2.5"
              }
              aria-label={
                scope === "characters"
                  ? "角色搜索结果"
                  : scope === "catalogs"
                    ? "目录搜索结果"
                    : "分类搜索结果"
              }
            >
              {directory.items.map((item) =>
                item.character ? (
                  <CharacterCard
                    character={item.character}
                    displayName={item.title}
                    originalName={item.subtitle ?? item.title}
                    headingLevel={2}
                    key={item.href}
                  />
                ) : item.catalog ? (
                  <CatalogListRow catalog={item.catalog} key={item.href} />
                ) : (
                  <Link
                    className="grid gap-1 border-b border-border p-4 text-foreground no-underline hover:bg-primary/5 md:grid-cols-[minmax(0,1fr)_auto]"
                    to={item.href}
                    key={item.href}
                  >
                    <strong>{item.title}</strong>
                    {item.subtitle ? <span>{item.subtitle}</span> : null}
                    <small>{item.meta}</small>
                  </Link>
                ),
              )}
            </section>
          ) : (
            <EmptyState title={`没有找到匹配的${scopeLabel}。`} />
          )}
          {directory ? (
            <PaginationLinks
              basePath="/search"
              page={page}
              pageSize={directory.pageSize}
              params={{ q: query, scope }}
              total={directory.total}
            />
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

async function listDirectory(
  runtime: AppRuntime,
  scope: string,
  query: string,
  page: number,
) {
  const pageSize = 20;
  let items: Array<{
    href: string;
    title: string;
    subtitle: string | null;
    meta: string;
    character?: Pick<
      CharacterIndexEntry,
      "id" | "portrait" | "workCount" | "commentCount" | "materialCount"
    >;
    catalog?: CatalogSummary;
  }>;
  if (scope === "creators")
    items = (await listPublicCreators(runtime, { query, limit: 300 })).map(
      (item) => ({
        href: `/creators/${item.id}`,
        title: item.name,
        subtitle: null,
        meta: `${item.workCreditCount} 个作品`,
      }),
    );
  else if (scope === "characters") {
    const characters = await searchPublicCharacters(runtime, {
      query,
      page,
      pageSize,
    });
    const visibleCharacters = characters.items;
    const { commentCounts, materialCounts } = visibleCharacters.length
      ? await readCharacterCounts(
          runtime,
          visibleCharacters.map((character) => character.id),
        )
      : {
          commentCounts: new Map<number, number>(),
          materialCounts: new Map<number, number>(),
        };
    items = visibleCharacters.map((item) => ({
      href: `/characters/${item.id}`,
      title: item.primaryName,
      subtitle: item.originalName,
      meta: `${item.workCount} 个作品`,
      character: {
        id: item.id,
        portrait: item.defaultPortrait,
        workCount: item.workCount,
        commentCount: commentCounts.get(item.id) ?? 0,
        materialCount: materialCounts.get(item.id) ?? 0,
      },
    }));
    return { items, pageSize, total: characters.total };
  } else if (scope === "tags")
    items = (await listPublicTags(runtime, { query, limit: 300 })).map(
      (item) => ({
        href: `/games?tag=${item.id}`,
        title: item.name,
        subtitle: null,
        meta: `${item.workCount} 个作品`,
      }),
    );
  else if (scope === "catalogs")
    items = (await searchCatalogs(runtime, query, 300)).map((item) => ({
      href: `/catalogs/${item.id}`,
      title: item.title,
      subtitle: null,
      meta: `${item.itemCount} 个游戏 · ${item.ownerName}`,
      catalog: item,
    }));
  else items = [];
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pageSize,
    total: items.length,
  };
}

function searchHref(query: string, scope: string) {
  const params = new URLSearchParams({ scope });
  if (query) params.set("q", query);
  return `/search?${params.toString()}`;
}
