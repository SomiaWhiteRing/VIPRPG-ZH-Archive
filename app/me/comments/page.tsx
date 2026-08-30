import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserComments } from "@/lib/server/db/work-community";
import { formatDate } from "@/lib/format";
import { AccountEmpty } from "../account-content";
export const dynamic = "force-dynamic";
export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page); const user = await requireAccountUser(`/me/comments${page > 1 ? `?page=${page}` : ""}`); const result = await searchUserComments({ userId: user.id, page, pageSize: 20 });
  return <div><PageHeader title="我的评论" subtitle={`共 ${result.total} 条评论；隐藏或删除的内容仍仅在这里对你可见。`} />{result.items.length ? <ul className="divide-y divide-border border-y border-border">{result.items.map((comment) => <li className="grid gap-2 py-4" key={comment.id}><div className="flex items-center justify-between gap-3"><Link className="font-semibold" href={`/games/${comment.workId}#comment-${comment.id}`}>{comment.workTitle}</Link><StatusBadge kind="publication" value={comment.status} /></div><p className="m-0 whitespace-pre-wrap text-sm">{comment.body || "这条评论已删除。"}</p><span className="text-xs text-muted">更新于 {formatDate(comment.updatedAt)} · {comment.likeCount} 个赞</span></li>)}</ul> : <AccountEmpty>还没有发表过评论。</AccountEmpty>}<PaginationLinks basePath="/me/comments" page={page} hasNext={page * 20 < result.total} /></div>;
}
