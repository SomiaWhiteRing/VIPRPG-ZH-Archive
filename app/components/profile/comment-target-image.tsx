import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { commentTargetHref } from "@/lib/comment-target";
import type { UserCommentSummary } from "@/lib/dto/db/work-community";
import { Link } from "react-router";

export function CommentTargetImage({ comment }: { comment: UserCommentSummary }) {
  return (
    <Link
      aria-label={`查看${comment.target.kind === "work" ? "作品" : comment.target.kind === "creator" ? "作者" : "角色"}：${comment.targetTitle}`}
      className="block w-24 shrink-0"
      to={commentTargetHref(comment.target)}
    >
      {comment.target.kind === "work" ? (
        <span className="relative block aspect-4/3 overflow-hidden rounded-md border border-border bg-muted/15">
          <WorkThumbnail
            blobSha256={comment.coverBlobSha256}
            width={96}
            height={72}
            fallback="暂无封面"
            fallbackClassName="flex h-full items-center justify-center text-xs text-muted"
          />
        </span>
      ) : comment.target.kind === "creator" ? (
        <CreatorPortrait
          avatarBlobSha256={comment.avatarBlobSha256}
          name={comment.targetTitle}
          size={72}
          className="size-[72px] text-2xl"
        />
      ) : (
        <CharacterPortrait
          displayName={comment.targetTitle}
          portrait={comment.portrait}
          toneKey={comment.target.id}
          size={72}
          className="size-[72px] text-2xl"
        />
      )}
    </Link>
  );
}
