import { CommentSummaryList } from "@/app/components/profile/comment-summary-list";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserComments } from "@/lib/server/db/work-community";
import { AccountEmpty } from "@/app/components/profile/account-content";
export const dynamic = "force-dynamic";
export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page); const user = await requireAccountUser(`/me/comments${page > 1 ? `?page=${page}` : ""}`); const result = await searchUserComments({ userId: user.id, page, pageSize: 20 });
  return <div><PageHeader title="我的评论" subtitle={`共 ${result.total} 条评论；隐藏或删除的内容仍仅在这里对你可见。`} />{result.items.length ? <CommentSummaryList items={result.items} showStatus /> : <AccountEmpty>还没有发表过评论。</AccountEmpty>}<PaginationLinks basePath="/me/comments" page={page} pageSize={result.pageSize} total={result.total} /></div>;
}
