import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { commentTargetHref } from "@/lib/comment-target";
import type { UserCommentSummary } from "@/lib/dto/db/work-community";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

export function CommentTargetImage({ comment }: { comment: UserCommentSummary }) {
  const t = useMessages();
  return (
    <Link
      aria-label={t(`comment.openTarget.${comment.target.kind}`, { title: comment.targetTitle })}
      className="block w-24 shrink-0"
      to={commentTargetHref(comment.target)}
    >
      {comment.target.kind === "work" || comment.target.kind === "catalog" ? (
        <span className="relative block aspect-4/3 overflow-hidden rounded-md border border-border bg-muted/15">
          <WorkThumbnail
            blobSha256={comment.coverBlobSha256}
            width={96}
            height={72}
            fallback={t("work.noCover")}
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
