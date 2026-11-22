import { WorkCard } from "@/app/components/work/work-card";
import { WorkPopularityStats, workPopularityLabel, useShowGameCardInteractionData } from "@/app/components/work/work-popularity-stats";
import type { GameCardSummary } from "@/lib/dto/db/game-library";
import { formatBytes } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { ReactNode } from "react";
import { useArchiveDownload } from "@/app/components/use-archive-download";
import { useUiLocale } from "@/lib/i18n/react";

export function GameCard({ work, action, children, imagePriority = false, titleAs }: {
  work: GameCardSummary;
  action?: ReactNode;
  children?: ReactNode;
  imagePriority?: boolean;
  titleAs?: "h2" | "h3";
}) {
  const { downloadSize } = useArchiveDownload();
  const locale = useUiLocale();
  const showInteractionData = useShowGameCardInteractionData();
  const sizeBytes = downloadSize(work);
  const title = work.chineseTitle || work.originalTitle;
  const originalTitle =
    work.chineseTitle && work.chineseTitle !== work.originalTitle
      ? work.originalTitle
      : null;
  const year = /^\d{4}/.exec(work.originalReleaseDate ?? "")?.[0] ?? null;
  const language = languageLabel(work.language, locale);
  const currentLanguage = locale === "zh-Hans" ? "zh-CN" : locale;
  const size =
    work.distribution === "archive" && sizeBytes !== null && sizeBytes > 0
      ? formatBytes(sizeBytes)
      : null;

  return (
    <WorkCard
      href={`/games/${work.id}`}
      title={title}
      titleLanguageBadge={work.language === currentLanguage ? undefined : language}
      originalTitle={originalTitle}
      coverBlobSha256={work.coverBlobSha256}
      description={[engineLabel(work.engineFamily, locale), language, year, size,
        showInteractionData ? workPopularityLabel(work, locale) : null,
      ].filter(Boolean).join("，")}
      imagePriority={imagePriority}
      titleAs={titleAs}
      imageBadge={size}
      action={action}
      imageMetadata={showInteractionData ? <WorkPopularityStats stats={work} /> : undefined}
    >
      {children}
    </WorkCard>
  );
}
