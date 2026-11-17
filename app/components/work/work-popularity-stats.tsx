import type { WorkCommunitySummary } from "@/lib/dto/db/work-community";
import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { Eye, Gamepad2, Heart, MessageCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import type { MouseEventHandler, ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";

type Counts = Pick<WorkCommunitySummary, "viewCount" | "playerCount" | "commentCount" | "favoriteCount">;

const metrics = [
  { key: "viewCount", Icon: Eye, label: "work.stats.views", shortLabel: "work.stats.viewsShort" },
  { key: "playerCount", Icon: Gamepad2, label: "library.players", shortLabel: "work.stats.playsShort" },
  { key: "commentCount", Icon: MessageCircle, label: "library.comments", shortLabel: "work.stats.commentsShort" },
  { key: "favoriteCount", Icon: Heart, label: "library.favorites", shortLabel: "work.stats.favoritesShort" },
] as const;

const compactCount = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function useShowGameCardInteractionData(): boolean {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return root?.session?.preferences.showGameCardInteractionData ?? false;
}

export function workPopularityLabel(stats: Counts, locale: UiLocale): string {
  return metrics.map(({ key, label }) => `${translate(locale, label)} ${formatNumber(stats[key], locale)}`)
    .join(locale === DEFAULT_UI_LOCALE ? "，" : ", ");
}

export function WorkPopularityStats({ stats, showLabels = false }: { stats: Counts; showLabels?: boolean }) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <WorkCardStats label={t("work.stats.title")} showLabels={showLabels}>
      {metrics.map(({ key, Icon, label, shortLabel }) => {
        const count = stats[key];
        const text = t(label);
        const metric = `${text} ${formatNumber(count, locale)}`;
        return <WorkCardStat key={key} Icon={Icon} label={text} count={count} shortLabel={showLabels ? t(shortLabel) : undefined}
          title={key === "playerCount" ? t("work.stats.playHint", { metric }) : metric} />;
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
  const locale = useUiLocale();
  const formatted = formatNumber(count, locale);
  const compact = locale === DEFAULT_UI_LOCALE ? compactCount : new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const content = <>
    <Icon aria-hidden className="size-3 shrink-0 min-[641px]:size-3.5" />
    <span className="sr-only">{label} {formatted}</span>
    <span aria-hidden>{count >= 10000 ? compact.format(count) : formatted}</span>
    {shortLabel ? <span aria-hidden>{shortLabel}</span> : null}
  </>;
  const tooltip = title ?? `${label} ${formatted}`;
  return onClick ? <Button type="button" variant="ghost" disabled={disabled} onClick={onClick} title={tooltip}
    className="pointer-events-auto h-auto min-h-6 gap-1 rounded-sm p-0 text-inherit font-normal tabular-nums hover:bg-white/10 [&_svg]:size-3 min-[641px]:[&_svg]:size-3.5">{content}</Button>
    : <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" title={tooltip}>{content}</span>;
}
