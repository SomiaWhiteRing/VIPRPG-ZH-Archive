import Image from "next/image";
import Link from "next/link";
import type { GameWorkSummary } from "@/lib/server/db/game-library";
import { engineLabel, engineShortLabel, languageLabel } from "@/lib/labels";
import { formatBytes } from "@/lib/format";

export function GameCard({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;
  const originalTitle =
    work.chineseTitle && work.chineseTitle !== work.originalTitle
      ? work.originalTitle
      : null;
  const year = /^\d{4}/.exec(work.originalReleaseDate ?? "")?.[0] ?? null;
  const engine = engineShortLabel(work.engineFamily);
  const language = languageLabel(work.language);
  const size =
    work.distribution === "archive" && work.totalSizeBytes > 0
      ? formatBytes(work.totalSizeBytes)
      : null;
  const meta = [engine, language, year].filter((value): value is string => Boolean(value));

  return (
    <Link
      aria-label={[title, engineLabel(work.engineFamily), language, year, size]
        .filter(Boolean)
        .join("，")}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={`/games/${work.id}`}
    >
      <div className="relative grid aspect-video place-items-center overflow-hidden bg-muted/15 font-mono text-xs font-bold text-muted">
        {work.previewBlobSha256 ? (
          <Image
            alt=""
            className="h-full w-full object-cover"
            height={236}
            src={`/api/media/blobs/${work.previewBlobSha256}`}
            unoptimized
            width={420}
          />
        ) : (
          <span>{engineLabel(work.engineFamily)}</span>
        )}
        {size ? (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/80 px-1.5 py-0.5 font-mono text-[11px] font-normal text-white max-[640px]:hidden">
            {size}
          </span>
        ) : null}
      </div>
      <div className="grid gap-1 p-2 min-[641px]:px-3 min-[641px]:pt-2.5 min-[641px]:pb-3">
        <h3 className="m-0 line-clamp-2 h-[calc(1.45em*2)] text-[12.5px] font-normal leading-[1.45] min-[641px]:text-[14.5px] min-[641px]:font-semibold">
          {title}
          {originalTitle ? (
            <span className="hidden text-xs font-normal text-muted min-[641px]:block">
              {originalTitle}
            </span>
          ) : null}
        </h3>
        <p className="hidden truncate font-mono text-[11.5px] text-muted min-[641px]:block">
          {meta.map((value, index) => (
            <span key={`${value}-${index}`}>
              {index > 0 ? <span className="mx-1.5 text-muted/55">·</span> : null}
              <span className={index === 0 ? "font-semibold text-primary" : undefined}>{value}</span>
            </span>
          ))}
        </p>
      </div>
    </Link>
  );
}
