import { CommentTargetImage } from "@/app/components/profile/comment-target-image";
import { commentTargetHref } from "@/lib/comment-target";
import type { UserCommentSummary } from "@/lib/dto/db/work-community";
import { Link } from "react-router";

export function RecentCommentList({
  items,
}: {
  items: UserCommentSummary[];
}) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((comment, index) => (
        <li
          className={`items-start gap-3 py-3 ${index >= 2 ? "hidden sm:flex" : "flex"}`}
          key={comment.id}
        >
          <CommentTargetImage comment={comment} />
          <div className="min-w-0 flex-1">
            <Link
              className="font-semibold"
              to={`${commentTargetHref(comment.target)}#comment-${comment.id}`}
            >
              {comment.targetTitle}
            </Link>
            <p className="mt-1 line-clamp-2 text-[15px] text-muted">
              {comment.body}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
