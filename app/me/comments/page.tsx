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
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/comments${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await searchUserComments(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });

  return { page, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的评论", page: loaderData?.page }, error);

export default function CommentsPage() {
  const { page, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        title="我的评论"
        subtitle={`共 ${result.total} 条评论；隐藏或删除的内容仍仅在这里对你可见。`}
      />
      {result.items.length ? (
        <CommentSummaryList items={result.items} showStatus />
      ) : (
        <AccountEmpty>还没有发表过评论。</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/comments"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
