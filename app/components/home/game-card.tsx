import { WorkCard } from "@/app/components/work/work-card";
import { WorkPopularityStats, workPopularityLabel, useShowGameCardInteractionData } from "@/app/components/work/work-popularity-stats";
import type { GameCardSummary } from "@/lib/dto/db/game-library";
import { formatBytes } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { ReactNode } from "react";
import { useArchiveDownload } from "@/app/components/use-archive-download";

export function GameCard({ work, action, children }: { work: GameCardSummary; action?: ReactNode; children?: ReactNode }) {
  const { downloadSize } = useArchiveDownload();
  const showInteractionData = useShowGameCardInteractionData();
  const sizeBytes = downloadSize(work);
  const title = work.chineseTitle || work.originalTitle;
  const originalTitle =
    work.chineseTitle && work.chineseTitle !== work.originalTitle
      ? work.originalTitle
      : null;
  const year = /^\d{4}/.exec(work.originalReleaseDate ?? "")?.[0] ?? null;
  const language = languageLabel(work.language);
  const size =
    work.distribution === "archive" && sizeBytes !== null && sizeBytes > 0
      ? formatBytes(sizeBytes)
      : null;

  return (
    <WorkCard
      href={`/games/${work.id}`}
      title={title}
      originalTitle={originalTitle}
      coverBlobSha256={work.coverBlobSha256}
      ariaLabel={[title, engineLabel(work.engineFamily), language, year, size,
        showInteractionData ? workPopularityLabel(work) : null,
      ].filter(Boolean).join("，")}
      imageBadge={size}
      action={action}
      imageMetadata={showInteractionData ? <WorkPopularityStats stats={work} /> : undefined}
    >
      {children}
    </WorkCard>
  );
}
