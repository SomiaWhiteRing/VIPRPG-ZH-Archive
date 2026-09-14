import { getForumRuntime } from "@/lib/server/forum/next";
import { resolveTags } from "@/lib/server/forum/queries";
import { indexedForumSearch, type PublicSearchPage } from "@/lib/server/forum/public-queries";
import { HttpError } from "@/lib/server/http/json";
import { DiscussionSearch } from "./search-client";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { forumPage } from "@/lib/forum";
import { FORUM_SEARCH_PAGE_SIZE } from "@/lib/forum-search-index";

export async function DiscussionSearchResults({ params }: {
  params: Record<string, string | string[] | undefined>;
}) {
  const ctx = getForumRuntime();
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const featured = params.featured === "1";
  const page = forumPage(params.page);
  let tags: Awaited<ReturnType<typeof resolveTags>> = [];
  let result: PublicSearchPage = { items: [], total: 0, page: 1, pageSize: FORUM_SEARCH_PAGE_SIZE };
  let error;
  try {
    tags = await resolveTags(ctx, params.tag ? Array.isArray(params.tag) ? params.tag : [params.tag] : []);
    result = await indexedForumSearch(ctx, { query, tags: tags.map((tag) => tag.id), featured, page });
  } catch (caught) {
    if (!(caught instanceof HttpError) || caught.status !== 400) throw caught;
    error = caught.message;
  }
  return <>
    <DiscussionSearch key={JSON.stringify(params)} query={query} tags={tags} featured={featured} result={result} error={error} />
    {!error ? <PaginationLinks basePath="/search" page={result.page} pageSize={result.pageSize} total={result.total}
      params={{scope: "discussions", q: query, tag: tags.map((tag) => String(tag.id)), featured: featured ? "1" : undefined}} /> : null}
  </>;
}
