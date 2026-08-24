import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { SearchResultRow } from "@/app/components/search/search-result-row";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { listPublicCharacters, listPublicSeries, listPublicTags } from "@/lib/server/db/taxonomy-library";
import { listPublicCreators } from "@/lib/server/db/creator-library";
import { searchGameWorks } from "@/lib/server/db/game-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";

export const dynamic = "force-dynamic";
type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const SCOPES = [
  ["works", "作品"],
  ["creators", "作者"],
  ["characters", "角色"],
  ["tags", "标签"],
  ["series", "系列"],
] as const;

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const requestedScope = stringParam(params.scope);
  const scope = SCOPES.some(([value]) => value === requestedScope) ? requestedScope : "works";
  const page = Math.max(1, Number.parseInt(stringParam(params.page) || "1", 10) || 1);
  const scopeLabel = SCOPES.find(([value]) => value === scope)?.[1] ?? "作品";
  const result = query && scope === "works" ? await searchGameWorks({ query, page }) : null;
  const directory = query && scope !== "works" ? await listDirectory(scope, query, page) : null;

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 sm:py-16">
      <header className="mb-6 border-b border-border pb-6">
        <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">SEARCH</p>
        <h1 className="text-3xl font-extrabold tracking-tight">搜索作品与分类</h1>
        <p className="mt-2 text-muted">按标题、作者、标签、角色或系列查找内容。</p>
      </header>
      <form className="my-6 flex gap-2" action="/search" method="get">
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
        />
        <input name="scope" type="hidden" value={scope} />
        <Rm2kButton type="submit">搜索</Rm2kButton>
      </form>
      <nav
        className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm font-bold"
        aria-label="搜索范围"
      >
        {SCOPES.map(([value, label]) => (
          <Link
            className={scope === value ? "text-primary underline decoration-2 underline-offset-4" : undefined}
            href={searchHref(query, value)}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!query ? (
        <EmptyState title="输入关键词开始搜索。" />
      ) : result ? (
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
            hasNext={page < result.totalPages}
            params={{ q: query, scope }}
          />
        </>
      ) : (
        <>
          <p className="my-6 text-sm text-muted">
            “{query}”在{scopeLabel}中找到 {formatNumber(directory?.total ?? 0)} 个结果
          </p>
          {directory && directory.items.length > 0 ? (
            <section className="grid gap-2.5" aria-label="分类搜索结果">
              {directory.items.map((item) => (
                <Link
                  className="grid gap-1 border-b border-border p-4 text-foreground no-underline hover:bg-primary/5 md:grid-cols-[minmax(0,1fr)_auto]"
                  href={item.href}
                  key={item.href}
                >
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                  <small>{item.meta}</small>
                </Link>
              ))}
            </section>
          ) : (
            <EmptyState title={`没有找到匹配的${scopeLabel}。`} />
          )}
          {directory ? (
            <PaginationLinks
              basePath="/search"
              page={page}
              hasNext={page < directory.totalPages}
              params={{ q: query, scope }}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

async function listDirectory(scope: string, query: string, page: number) {
  const pageSize = 20;
  let items;
  if (scope === "creators")
    items = (await listPublicCreators({ query, limit: 300 })).map((item) => ({
      href: `/creators/${item.slug}`,
      title: item.name,
      subtitle: item.originalName,
      meta: `${item.workCreditCount} 个作品`,
    }));
  else if (scope === "characters")
    items = (await listPublicCharacters({ query, limit: 300 })).map((item) => ({
      href: `/characters/${item.slug}`,
      title: item.primaryName,
      subtitle: item.originalName,
      meta: `${item.workCount} 个作品`,
    }));
  else if (scope === "tags")
    items = (await listPublicTags({ query, limit: 300 })).map((item) => ({
      href: `/tags/${item.slug}`,
      title: item.name,
      subtitle: item.slug,
      meta: `${item.workCount} 个作品`,
    }));
  else
    items = (await listPublicSeries({ query, limit: 300 })).map((item) => ({
      href: `/series/${item.slug}`,
      title: item.title,
      subtitle: item.titleOriginal,
      meta: `${item.workCount} 个作品`,
    }));
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function searchHref(query: string, scope: string) {
  const params = new URLSearchParams({ scope });
  if (query) params.set("q", query);
  return `/search?${params.toString()}`;
}
