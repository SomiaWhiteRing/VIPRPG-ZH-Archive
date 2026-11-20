import { CommentTargetImage } from "@/app/components/profile/comment-target-image";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { commentTargetHref } from "@/lib/comment-target";
import type { UserCommentSummary } from "@/lib/dto/db/work-community";
import { Timestamp } from "@/app/components/ui/timestamp";
import { ThumbsUp } from "lucide-react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

// Public filtering is deliberately performed by the server query, before rendering.
export function CommentSummaryList({
  items,
  showStatus = false,
}: {
  items: UserCommentSummary[];
  showStatus?: boolean;
}) {
  const t = useMessages();
  return (
    <ul className="divide-y divide-border border-b border-border">
      {items.map((comment) => (
        <li className="flex items-start gap-3 py-4" key={comment.id}>
          <CommentTargetImage comment={comment} />
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 wrap-anywhere">
            <div className="flex items-center justify-between gap-3">
              <Link
                className="min-w-0 font-semibold"
                to={`${commentTargetHref(comment.target)}#comment-${comment.id}`}
              >
                {comment.targetTitle}
              </Link>
              {showStatus && comment.status !== "published" ? (
                <StatusBadge kind="publication" value={comment.status} />
              ) : null}
            </div>
            <p className="m-0 whitespace-pre-wrap text-[15px]">
              {comment.body}{comment.imageCount > 0 ? ` ${t("publicProfile.imageCount", { count: comment.imageCount })}` : ""}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted">
              <Timestamp value={comment.updatedAt} />
              <span className="inline-flex items-center gap-1">
                <ThumbsUp aria-hidden className="size-3.5" />
                <span className="sr-only">{t("publicProfile.likes")}</span>
                {comment.likeCount}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
