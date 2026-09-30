import type { WorkCommunitySummary } from "@/lib/dto/db/work-community";
import { formatNumber } from "@/lib/format";
import { Eye, Gamepad2, Heart, MessageCircle } from "lucide-react";
import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";

type Counts = Pick<WorkCommunitySummary, "viewCount" | "playerCount" | "commentCount" | "favoriteCount">;

const metrics = [
  { key: "viewCount", Icon: Eye, label: "浏览量", shortLabel: "浏览" },
  { key: "playerCount", Icon: Gamepad2, label: "游玩人数", shortLabel: "游玩" },
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
    <div aria-label="热度统计" className={showLabels
      ? "mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs leading-4 text-muted"
      : "flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-4 min-[641px]:gap-x-3 min-[641px]:text-xs"}>
      {metrics.map(({ key, Icon, label, shortLabel }) => {
        const count = stats[key];
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" title={`${label} ${formatNumber(count)}`} key={key}>
            <Icon aria-hidden className="size-3 shrink-0 min-[641px]:size-3.5" />
            <span className="sr-only">{label} {formatNumber(count)}</span>
            <span aria-hidden>{count >= 10000 ? compactCount.format(count) : formatNumber(count)}</span>
            {showLabels ? <span aria-hidden>{shortLabel}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
