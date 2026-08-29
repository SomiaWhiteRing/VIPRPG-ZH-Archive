import Image from "next/image";
import Link from "next/link";
import type { GameWorkSummary } from "@/lib/server/db/game-library";
import { engineLabel, languageLabel } from "@/lib/labels";
import { formatBytes } from "@/lib/format";
import { buildArchiveDownloadUrl } from "@/lib/archive/web-play";

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
        className="group relative block aspect-video w-26 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 sm:w-32"
        href={`/games/${work.id}`}
      >
        {work.previewBlobSha256 ? (
          <Image
            alt={title}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            height={72}
            src={`/api/media/blobs/${work.previewBlobSha256}`}
            unoptimized
            width={128}
          />
        ) : (
          <span className="grid h-full place-items-center px-1 text-center font-mono text-[10.5px] text-muted">
            {engineLabel(work.engineFamily)}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          className="text-[15.5px] font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3"
          href={`/games/${work.id}`}
        >
          {title}
        </Link>
        {work.chineseTitle ? (
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{work.originalTitle}</p>
        ) : null}
        <p className="mt-1 font-mono text-xs text-muted">
          {[work.originalReleaseDate, engineLabel(work.engineFamily), languageLabel(work.language)]
            .filter(Boolean)
            .join(" / ")}
        </p>
      </div>
      {download ? (
        <a
          className="hidden min-h-11 shrink-0 self-center flex-col items-center justify-center rounded-md border border-border bg-card px-3.5 text-center hover:border-primary/50 hover:bg-primary/10 min-[561px]:inline-flex"
          href={download.href}
          rel={download.external ? "noreferrer" : undefined}
          target={download.external ? "_blank" : undefined}
        >
          <span className="whitespace-nowrap text-[13px] font-semibold">{download.label}</span>
          <span className="font-mono text-[11px] text-muted">{download.detail}</span>
        </a>
      ) : null}
    </article>
  );
}
