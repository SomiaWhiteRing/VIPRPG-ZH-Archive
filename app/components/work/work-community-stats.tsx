import { formatNumber } from "@/lib/format";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages, useUiLocale } from "@/lib/i18n/react";

export function WorkCommunityStats({
  commentCount,
  favoriteCount,
  collectionHref,
  playerCount,
  viewCount,
}: {
  commentCount: number;
  favoriteCount: number;
  collectionHref?: string;
  playerCount: number;
  viewCount: number;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <div aria-label={t("work.stats.title")} className="flex flex-wrap gap-3.5 text-xs text-muted">
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(viewCount, locale)}</strong> {t("work.stats.viewsShort")}</span>
      <span title={t("work.stats.playHint", { metric: t("library.players") })}><strong className="font-mono font-semibold text-foreground">{formatNumber(playerCount, locale)}</strong> {t("work.stats.playsShort")}</span>
      {collectionHref ? <>
        <span><strong className="font-mono font-semibold text-foreground">{formatNumber(commentCount, locale)}</strong> {t("work.stats.commentsShort")}</span>
        <Link className="hover:text-primary hover:underline" to={collectionHref}><strong className="font-mono font-semibold text-foreground">{formatNumber(favoriteCount, locale)}</strong> {t("work.stats.favoritesShort")}</Link>
      </> : null}
    </div>
  );
}
