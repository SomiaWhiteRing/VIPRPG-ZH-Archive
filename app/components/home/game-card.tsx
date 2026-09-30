import { WorkCard } from "@/app/components/work/work-card";
import type { GameCardSummary } from "@/lib/dto/db/game-library";
import { formatBytes, formatNumber } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import { Eye, Gamepad2, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useArchiveDownload } from "@/app/components/use-archive-download";

const compactCount = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function GameCard({ work, action, children }: { work: GameCardSummary; action?: ReactNode; children?: ReactNode }) {
  const { downloadSize } = useArchiveDownload();
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
  const stats = [
    { Icon: Eye, label: "浏览量", count: work.viewCount },
    { Icon: Gamepad2, label: "游玩人数", count: work.playerCount },
    { Icon: MessageCircle, label: "评论数", count: work.commentCount },
  ];

  return (
    <WorkCard
      href={`/games/${work.id}`}
      title={title}
      originalTitle={originalTitle}
      coverBlobSha256={work.coverBlobSha256}
      ariaLabel={[title, engineLabel(work.engineFamily), language, year, size,
        ...stats.map(({ label, count }) => `${label} ${formatNumber(count)}`),
      ].filter(Boolean).join("，")}
      imageBadge={size}
      action={action}
      imageMetadata={
        <div aria-label="热度统计" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] leading-4 min-[641px]:gap-x-3.5 min-[641px]:text-xs">
          {stats.map(({ Icon, label, count }) => (
            <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" title={`${label} ${formatNumber(count)}`} key={label}>
              <Icon aria-hidden className="size-3 shrink-0 min-[641px]:size-3.5" />
              <span className="sr-only">{label} </span>
              {count >= 10000 ? compactCount.format(count) : formatNumber(count)}
            </span>
          ))}
        </div>
      }
    >
      {children}
    </WorkCard>
  );
}
