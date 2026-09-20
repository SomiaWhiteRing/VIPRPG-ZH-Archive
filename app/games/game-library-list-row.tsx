import { WorkListRow } from "@/app/components/work/work-list-row";
import { buildArchiveDownloadUrl } from "@/lib/archive/web-play";
import type { GameWorkSummary } from "@/lib/dto/db/game-library";
import { formatBytes } from "@/lib/format";
import type { ReactNode } from "react";

export function GameLibraryListRow({
  work, action, children, showDownload = true,
}: {
  work: GameWorkSummary;
  action?: ReactNode;
  children?: ReactNode;
  showDownload?: boolean;
}) {
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
    <WorkListRow
      href={`/games/${work.id}`}
      title={title}
      coverBlobSha256={work.coverBlobSha256}
      originalTitle={work.chineseTitle ? work.originalTitle : null}
      authorName={work.creators
        .filter((creator) => creator.roleKey === "author")
        .map((creator) => creator.displayName.trim())
        .filter(Boolean)
        .join("、")}
      releaseDate={work.originalReleaseDate}
      engineFamily={work.engineFamily}
      language={work.language}
      action={action ?? (showDownload && download ? (
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
      ) : null)}
    >
      {children}
    </WorkListRow>
  );
}
