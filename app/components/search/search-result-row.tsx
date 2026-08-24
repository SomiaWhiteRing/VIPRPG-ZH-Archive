import Image from "next/image";
import Link from "next/link";
import type { GameWorkSummary } from "@/lib/server/db/game-library";
import { engineLabel } from "@/lib/labels";
import { publicCopy } from "@/lib/public-copy";

export function SearchResultRow({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;
  return (
    <Link
      className="grid gap-4 rounded-lg border border-border bg-card p-3 text-foreground no-underline hover:border-primary hover:shadow-surface md:grid-cols-[148px_minmax(0,1fr)]"
      href={`/games/${work.slug}`}
    >
      <div className="grid aspect-video place-items-center overflow-hidden bg-muted/15 text-xs font-bold text-muted">
        {work.previewBlobSha256 ? (
          <Image alt="" height={84} src={`/api/media/blobs/${work.previewBlobSha256}`} unoptimized width={148} />
        ) : (
          <span>{engineLabel(work.engineFamily)}</span>
        )}
      </div>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <strong>{title}</strong>
          {work.chineseTitle ? <span>{work.originalTitle}</span> : null}
        </div>
        <p>{publicCopy(work.description) || "暂无简介。"}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-h-6 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {engineLabel(work.engineFamily)}
          </span>
          {work.creators.slice(0, 1).map((creator) => (
            <span
              className="inline-flex min-h-6 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"
              key={creator.slug}
            >
              {creator.name}
            </span>
          ))}
          {work.characters.slice(0, 1).map((character) => (
            <span
              className="inline-flex min-h-6 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"
              key={character.slug}
            >
              {character.primaryName}
            </span>
          ))}
          {work.tags.slice(0, 2).map((tag) => (
            <span
              className="inline-flex min-h-6 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"
              key={tag.slug}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
