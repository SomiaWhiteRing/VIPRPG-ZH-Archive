import { parseCommentTargetKind } from "@/lib/comment-target";
import { CommentCategoryFilter } from "@/app/components/profile/comment-category-filter";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { searchUserComments } from "@/app/.server/db/work-community";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CommentSummaryList } from "@/app/components/profile/comment-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "comments",
  );
  const filters = await searchParams;
  const page = parseAccountPage(filters.page);
  const kind = parseCommentTargetKind(filters.kind);
  const result = await searchUserComments(runtime, {
    userId: user.id,
    publicOnly: true,
    page,
    pageSize: 20,
    kind,
  });
  const base = `/users/${user.id}/comments`;
  return { displayName: user.displayName, page, result, base, kind };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [loaderData?.displayName || "用户", "评论"],
      page: loaderData?.page,
    },
    error,
  );

export default function PublicComments() {
  const { page, result, base, kind } = useLoaderData<typeof loader>();
  return (
    <section aria-label="评论">
      <CommentCategoryFilter basePath={base} kind={kind} />
      {result.items.length ? (
        <CommentSummaryList items={result.items} />
      ) : (
        <AccountEmpty>{kind ? "这个类别下还没有公开评论。" : "还没有公开评论。"}</AccountEmpty>
      )}
      <PaginationLinks
        basePath={base}
        params={{ kind }}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </section>
  );
}
