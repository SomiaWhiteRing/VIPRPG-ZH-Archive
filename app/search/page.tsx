import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { SearchResultRow } from "@/app/components/search/search-result-row";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { listPublicCharacters, listPublicTags } from "@/lib/server/db/taxonomy-library";
import { listPublicCreators } from "@/lib/server/db/creator-library";
import { searchGameWorks } from "@/lib/server/db/game-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import { searchCatalogs } from "@/lib/server/db/catalogs";
import { redirect } from "next/navigation";
import { forumHref,forumPage } from "@/lib/forum";
import { resolveTags,searchForum } from "@/lib/server/forum/queries";
import { DiscussionSearch } from "./discussion-search";

export const dynamic = "force-dynamic";
type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const SCOPES = [
  ["works", "作品"],
  ["discussions", "讨论"],
  ["creators", "作者"],
  ["characters", "角色"],
  ["tags", "标签"],
  ["catalogs", "目录"],
] as const;

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const requestedScope = stringParam(params.scope);
  const scope = SCOPES.some(([value]) => value === requestedScope) ? requestedScope : "works";
  const page = Math.max(1, Number.parseInt(stringParam(params.page) || "1", 10) || 1);
  const scopeLabel = SCOPES.find(([value]) => value === scope)?.[1] ?? "作品";
  const result = query && scope === "works" ? await searchGameWorks({ query, page }) : null;
  const directory = query && scope !== "works" && scope !== "discussions" ? await listDirectory(scope, query, page) : null;
  const discussionTags=scope==="discussions"?await resolveTags(params.tag?(Array.isArray(params.tag)?params.tag:[params.tag]):[]):[];
  const discussionError=discussionTags.length>5?"最多选择 5 个 TAG，请移除多余筛选。":query.length>200?"搜索词最多 200 个字符。":undefined;
  const discussionResult=scope==="discussions"&&!discussionError?await searchForum({query,tags:discussionTags.map(t=>t.id),featured:params.featured==="1",latest:params.sort==="latest",page:forumPage(params.page)},null):{items:[],total:0,page:1,pageSize:30};
  if(scope==="discussions"&&!discussionError){const canonical=forumHref("/search",{scope,q:query,tag:discussionTags.map(t=>t.id),featured:params.featured==="1"?1:null,sort:params.sort==="latest"?"latest":null,page:discussionResult.page});const incoming=new URLSearchParams();for(const[key,value]of Object.entries(params))for(const item of Array.isArray(value)?value:value?[value]:[])incoming.append(key,item);if(canonical!==`/search?${incoming}`)redirect(canonical);}

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-4 sm:py-6">
      <header className="mb-6 border-b border-border pb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">搜索站内内容</h1>
      </header>
      {scope!=="discussions"?<form className="my-6 flex gap-2" action="/search" method="get">
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
      </form>:null}
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
      {scope==="discussions"?<DiscussionSearch key={JSON.stringify(params)} query={query} tags={discussionTags} featured={params.featured==="1"} latest={params.sort==="latest"} result={discussionResult} error={discussionError}/>:!query ? (
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
            pageSize={result.pageSize}
            params={{ q: query, scope }}
            total={result.total}
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
              pageSize={directory.pageSize}
              params={{ q: query, scope }}
              total={directory.total}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

async function listDirectory(scope: string, query: string, page: number) {
  const pageSize = 20;
  let items: Array<{ href: string; title: string; subtitle: string | null; meta: string }>;
  if (scope === "creators")
    items = (await listPublicCreators({ query, limit: 300 })).map((item) => ({
      href: `/creators/${item.id}`,
      title: item.name,
      subtitle: null,
      meta: `${item.workCreditCount} 个作品`,
    }));
  else if (scope === "characters")
    items = (await listPublicCharacters({ query, limit: 300 })).map((item) => ({
      href: `/games?character=${item.id}`,
      title: item.primaryName,
      subtitle: item.originalName,
      meta: `${item.workCount} 个作品`,
    }));
  else if (scope === "tags")
    items = (await listPublicTags({ query, limit: 300 })).map((item) => ({
      href: `/games?tag=${item.id}`,
      title: item.name,
      subtitle: null,
      meta: `${item.workCount} 个作品`,
    }));
  else if (scope === "catalogs")
    items = (await searchCatalogs(query, 300)).map((item) => ({
      href: `/catalogs/${item.id}`,
      title: item.title,
      subtitle: item.description,
      meta: `${item.itemCount} 个游戏 · ${item.ownerName}`,
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
