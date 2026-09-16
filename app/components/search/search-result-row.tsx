import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { Badge } from "@/app/components/ui/badge";
import Link from "next/link";
import type { GameWorkSummary } from "@/lib/server/db/game-library";
import { engineLabel } from "@/lib/labels";
import { publicCopy } from "@/lib/public-copy";

export function SearchResultRow({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;
  return (
    <Link
      className="grid gap-4 rounded-lg border border-border bg-card p-3 text-foreground no-underline hover:border-primary hover:shadow-surface md:grid-cols-[148px_minmax(0,1fr)]"
      href={`/games/${work.id}`}
    >
      <div className="grid aspect-4/3 place-items-center overflow-hidden bg-muted/15 text-xs font-bold text-muted">
        <WorkThumbnail blobSha256={work.previewBlobSha256} alt="" width={148} height={111} imageClassName="h-auto w-full object-cover" fallback={engineLabel(work.engineFamily)} />
      </div>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <strong>{title}</strong>
          {work.chineseTitle ? <span>{work.originalTitle}</span> : null}
        </div>
        <p>{publicCopy(work.description) || "暂无简介。"}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="subtle">
            {engineLabel(work.engineFamily)}
          </Badge>
          {work.creators.filter((creator) => creator.roleKey === "author").slice(0, 1).map((creator) => (
            <Badge
              variant="subtle"
              key={creator.id}
            >
              {creator.displayName}
            </Badge>
          ))}
          {work.characters.slice(0, 1).map((character) => (
            <Badge
              variant="subtle"
              key={character.id}
            >
              {character.displayName}
            </Badge>
          ))}
          {work.tags.slice(0, 2).map((tag) => (
            <Badge
              variant="subtle"
              key={tag.id}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      </div>
    </Link>
  );
}
