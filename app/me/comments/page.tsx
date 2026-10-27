import { parseCommentTargetKind } from "@/lib/comment-target";
import { CommentCategoryFilter } from "@/app/components/profile/comment-category-filter";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUserComments } from "@/app/.server/db/work-community";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CommentSummaryList } from "@/app/components/profile/comment-summary-list";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const filters = await searchParams;
  const page = parseAccountPage(filters.page);
  const kind = parseCommentTargetKind(filters.kind);
  const query = new URLSearchParams();
  if (kind) query.set("kind", kind);
  if (page > 1) query.set("page", String(page));
  const user = await requireAccountUser(
    runtime,
    `/me/comments${query.size ? `?${query}` : ""}`,
  );
  const result = await searchUserComments(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
    kind,
  });

  return { page, result, kind };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的评论", page: loaderData?.page }, error);

export default function CommentsPage() {
  const { page, result, kind } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        title="我的评论"
        subtitle={`${kind ? "当前类别" : ""}共 ${result.total} 条评论`}
      />
      <CommentCategoryFilter basePath="/me/comments" kind={kind} />
      {result.items.length ? (
        <CommentSummaryList items={result.items} showStatus />
      ) : (
        <AccountEmpty>{kind ? "这个类别下还没有评论。" : "还没有发表过评论。"}</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/comments"
        params={{ kind }}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
