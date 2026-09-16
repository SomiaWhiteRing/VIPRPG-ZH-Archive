import { forumPage } from "@/lib/forum";
import { FORUM_SEARCH_PAGE_SIZE } from "@/lib/forum-search-index";
import { HttpError } from "@/lib/http";
import type { AppRuntime } from "../runtime";
import { getForumRuntime } from "./context";
import type { PublicSearchPage } from "@/lib/dto/forum/activity";
import { indexedForumSearch } from "./public-queries";
export async function loadDiscussionSearch(
  runtime: AppRuntime,
  {
    params,
  }: {
    params: Record<string, string | string[] | undefined>;
  },
) {
  const ctx = getForumRuntime(runtime);
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const page = forumPage(params.page);
  let result: PublicSearchPage = {
    items: [],
    total: 0,
    page: 1,
    pageSize: FORUM_SEARCH_PAGE_SIZE,
  };
  let error;
  try {
    result = await indexedForumSearch(ctx, {
      query,
      tags: [],
      featured: false,
      page,
    });
  } catch (caught) {
    if (!(caught instanceof HttpError) || caught.status !== 400) throw caught;
    error = caught.message;
  }
  return { query, result, error };
}
