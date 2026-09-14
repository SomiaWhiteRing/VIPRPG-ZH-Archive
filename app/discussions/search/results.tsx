import { getForumRuntime } from "@/lib/server/forum/next";
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
  const page = forumPage(params.page);
  let result: PublicSearchPage = { items: [], total: 0, page: 1, pageSize: FORUM_SEARCH_PAGE_SIZE };
  let error;
  try {
    result = await indexedForumSearch(ctx, { query, tags: [], featured: false, page });
  } catch (caught) {
    if (!(caught instanceof HttpError) || caught.status !== 400) throw caught;
    error = caught.message;
  }
  return <>
    <DiscussionSearch query={query} result={result} error={error} />
    {!error ? <PaginationLinks basePath="/search" page={result.page} pageSize={result.pageSize} total={result.total}
      params={{scope: "discussions", q: query}} /> : null}
  </>;
}
