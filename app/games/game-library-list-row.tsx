import { WorkListSummary } from "@/app/components/work/work-list-summary";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { buildArchiveDownloadUrl } from "@/lib/archive/web-play";
import type { GameWorkSummary } from "@/lib/dto/db/game-library";
import { formatBytes } from "@/lib/format";
import { engineLabel } from "@/lib/labels";
import { Link } from "react-router";

export function GameLibraryListRow({ work }: { work: GameWorkSummary }) {
  const title = work.chineseTitle || work.originalTitle;
  const download = work.currentArchiveVersionId
    ? {
        href: buildArchiveDownloadUrl(work.currentArchiveVersionId),
        label: "下载 ZIP",
        detail: formatBytes(work.totalSizeBytes),
        external: false,
      }
    : work.externalDownloadUrl
      ? {
          href: work.externalDownloadUrl,
          label: "前往下载页",
          detail: "外部站点",
          external: true,
        }
      : null;

  return (
    <article className="flex items-start gap-3.5 py-3.5">
      <Link
        className="group relative block aspect-4/3 w-26 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 sm:w-32"
        to={`/games/${work.id}`}
      >
        <WorkThumbnail
          blobSha256={work.previewBlobSha256}
          alt={title}
          width={128}
          height={96}
          imageClassName="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          fallbackClassName="grid h-full place-items-center px-1 text-center font-mono text-[10.5px] text-muted"
          fallback={engineLabel(work.engineFamily)}
        />
      </Link>
      <WorkListSummary
        href={`/games/${work.id}`}
        title={title}
        originalTitle={work.chineseTitle ? work.originalTitle : null}
        releaseDate={work.originalReleaseDate}
        engineFamily={work.engineFamily}
        language={work.language}
        truncateOriginal
      ></WorkListSummary>
      {download ? (
        <a
          className="hidden min-h-11 shrink-0 self-center flex-col items-center justify-center rounded-md border border-border bg-card px-3.5 text-center hover:border-primary/50 hover:bg-primary/10 min-[561px]:inline-flex"
          href={download.href}
          rel={download.external ? "noreferrer" : undefined}
          target={download.external ? "_blank" : undefined}
        >
          <span className="whitespace-nowrap text-[13px] font-semibold">
            {download.label}
          </span>
          <span className="font-mono text-[11px] text-muted">
            {download.detail}
          </span>
        </a>
      ) : null}
    </article>
  );
}
