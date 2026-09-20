import { WorkCard } from "@/app/components/work/work-card";
import type { GameWorkSummary } from "@/lib/dto/db/game-library";
import { formatBytes } from "@/lib/format";
import { engineLabel, engineShortLabel, languageLabel } from "@/lib/labels";
import type { ReactNode } from "react";

export function GameCard({ work, action, children }: { work: GameWorkSummary; action?: ReactNode; children?: ReactNode }) {
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
  const meta = [engine, language, year].filter((value): value is string =>
    Boolean(value),
  );

  return (
    <WorkCard
      href={`/games/${work.id}`}
      title={title}
      originalTitle={originalTitle}
      coverBlobSha256={work.coverBlobSha256}
      ariaLabel={[title, engineLabel(work.engineFamily), language, year, size].filter(Boolean).join("，")}
      imageBadge={size}
      action={action}
      metadata={
        <p className="hidden truncate font-mono text-[11.5px] text-muted min-[641px]:block">
          {meta.map((value, index) => (
            <span key={`${value}-${index}`}>
              {index > 0 ? (
                <span className="mx-1.5 text-muted/55">·</span>
              ) : null}
              <span
                className={
                  index === 0 ? "font-semibold text-primary" : undefined
                }
              >
                {value}
              </span>
            </span>
          ))}
        </p>
      }
    >
      {children}
    </WorkCard>
  );
}
