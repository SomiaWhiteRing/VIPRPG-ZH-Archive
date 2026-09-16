import Link from "next/link";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { commentTargetHref } from "@/lib/comment-target";
import { formatDate } from "@/lib/format";
import type { UserCommentSummary } from "@/lib/server/db/work-community";

// Public filtering is deliberately performed by the server query, before rendering.
export function CommentSummaryList({ items, showStatus = false }: { items: UserCommentSummary[]; showStatus?: boolean }) {
  return <ul className="divide-y divide-border border-y border-border">
    {items.map((comment) => <li className="grid gap-2 py-4" key={comment.id}>
      <div className="flex items-center justify-between gap-3">
        <Link className="font-semibold" href={`${commentTargetHref(comment.target)}#comment-${comment.id}`}>{comment.targetTitle}</Link>
        {showStatus ? <StatusBadge kind="publication" value={comment.status} /> : null}
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm">{comment.body || (showStatus ? "这条评论已删除。" : "")}</p>
      <span className="text-xs text-muted">{showStatus ? "更新于 " : ""}{formatDate(comment.updatedAt)} · {comment.likeCount} 个赞</span>
    </li>)}
  </ul>;
}
