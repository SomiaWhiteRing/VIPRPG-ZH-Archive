import type { loadDiscussionSearch } from "@/app/.server/forum/search-page";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DiscussionSearch } from "./search-client";
export function DiscussionSearchResults({
  query,
  result,
  error,
}: Awaited<ReturnType<typeof loadDiscussionSearch>>) {
  return (
    <>
      <DiscussionSearch query={query} result={result} error={error} />
      {!error ? (
        <PaginationLinks
          basePath="/search"
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          params={{ scope: "discussions", q: query }}
        />
      ) : null}
    </>
  );
}
