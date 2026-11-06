import type { WorkCommunitySummary } from "@/lib/dto/db/work-community";
import { formatNumber } from "@/lib/format";
import { PLAY_COUNT_DESCRIPTION } from "@/lib/view-stats";
import { Eye, Gamepad2, Heart, MessageCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import type { MouseEventHandler, ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";

type Counts = Pick<WorkCommunitySummary, "viewCount" | "playerCount" | "commentCount" | "favoriteCount">;

const metrics = [
  { key: "viewCount", Icon: Eye, label: "浏览量", shortLabel: "浏览" },
  { key: "playerCount", Icon: Gamepad2, label: "游玩数", shortLabel: "游玩" },
  { key: "commentCount", Icon: MessageCircle, label: "评论数", shortLabel: "评论" },
  { key: "favoriteCount", Icon: Heart, label: "收藏数", shortLabel: "收藏" },
] as const;

const compactCount = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function useShowGameCardInteractionData(): boolean {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return root?.session?.preferences.showGameCardInteractionData ?? false;
}

export function workPopularityLabel(stats: Counts): string {
  return metrics.map(({ key, label }) => `${label} ${formatNumber(stats[key])}`).join("，");
}

export function WorkPopularityStats({ stats, showLabels = false }: { stats: Counts; showLabels?: boolean }) {
  return (
    <WorkCardStats label="热度统计" showLabels={showLabels}>
      {metrics.map(({ key, Icon, label, shortLabel }) => {
        const count = stats[key];
        return <WorkCardStat key={key} Icon={Icon} label={label} count={count} shortLabel={showLabels ? shortLabel : undefined}
          title={`${label} ${formatNumber(count)}${key === "playerCount" ? `；${PLAY_COUNT_DESCRIPTION}` : ""}`} />;
      })}
    </WorkCardStats>
  );
}

export function WorkCardStats({ label, showLabels = false, children }: { label: string; showLabels?: boolean; children: ReactNode }) {
  return <div aria-label={label} className={showLabels
    ? "mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs leading-4 text-muted"
    : "flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-4 min-[641px]:gap-x-3 min-[641px]:text-xs"}>{children}</div>;
}

export function WorkCardStat({ Icon, label, count, title, shortLabel, onClick, disabled }: {
  Icon: LucideIcon; label: string; count: number; title?: string; shortLabel?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>; disabled?: boolean;
}) {
  const content = <>
    <Icon aria-hidden className="size-3 shrink-0 min-[641px]:size-3.5" />
    <span className="sr-only">{label} {formatNumber(count)}</span>
    <span aria-hidden>{count >= 10000 ? compactCount.format(count) : formatNumber(count)}</span>
    {shortLabel ? <span aria-hidden>{shortLabel}</span> : null}
  </>;
  const tooltip = title ?? `${label} ${formatNumber(count)}`;
  return onClick ? <Button type="button" variant="ghost" disabled={disabled} onClick={onClick} title={tooltip}
    className="pointer-events-auto h-auto min-h-6 gap-1 rounded-sm p-0 text-inherit font-normal tabular-nums hover:bg-white/10 [&_svg]:size-3 min-[641px]:[&_svg]:size-3.5">{content}</Button>
    : <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" title={tooltip}>{content}</span>;
}
