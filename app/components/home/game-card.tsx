import Image from "next/image";
import Link from "next/link";
import type { GameWorkSummary } from "@/lib/server/db/game-library";
import { engineLabel, languageLabel } from "@/lib/labels";
import { publicCopy } from "@/lib/public-copy";

export function HomeGameCard({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;
  return (
    <Link
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm transition-shadow hover:border-primary/30 hover:shadow-card-hover"
      href={`/games/${work.id}`}
    >
      <div className="grid aspect-video place-items-center overflow-hidden bg-muted/15 text-xs font-bold text-muted">
        {work.previewBlobSha256 ? (
          <Image
            alt={title}
            className="h-auto w-full object-cover"
            height={240}
            src={`/api/media/blobs/${work.previewBlobSha256}`}
            unoptimized
            width={420}
          />
        ) : (
          <span>{engineLabel(work.engineFamily)}</span>
        )}
      </div>
      <div className="grid min-h-[210px] gap-3 p-4">
        <div>
          <span className="text-base font-semibold leading-tight text-foreground group-hover:text-accent">{title}</span>
          {work.chineseTitle ? <span className="text-sm text-foreground/60">{work.originalTitle}</span> : null}
        </div>
        <p className="line-clamp-2 overflow-hidden text-sm leading-6 text-muted">
          {publicCopy(work.description) || "暂无简介，进入作品页查看完整信息。"}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-h-6 items-center rounded border border-primary/30 px-2 py-0.5 text-xs font-bold text-primary">
            {engineLabel(work.engineFamily)}
          </span>
          <span className="inline-flex min-h-6 items-center rounded border border-primary/30 px-2 py-0.5 text-xs font-bold text-primary">
            {languageLabel(work.language)}
          </span>
          {work.isOriginal ? <span className="inline-flex min-h-6 items-center rounded border border-accent px-2 py-0.5 text-xs font-bold text-accent">本站原创</span> : null}
          {work.tags.slice(0, 2).map((tag) => (
            <span
              className="inline-flex min-h-6 items-center rounded border border-primary/30 px-2 py-0.5 text-xs font-bold text-primary"
              key={tag.id}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
