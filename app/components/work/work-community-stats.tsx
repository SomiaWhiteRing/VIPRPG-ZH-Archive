import { formatNumber } from "@/lib/format";
import { PLAY_COUNT_DESCRIPTION } from "@/lib/view-stats";
import { Link } from "react-router";

export function WorkCommunityStats({
  commentCount,
  favoriteCount,
  collectionHref,
  playerCount,
  viewCount,
}: {
  commentCount: number;
  favoriteCount: number;
  collectionHref: string;
  playerCount: number;
  viewCount: number;
}) {
  return (
    <div aria-label="热度统计" className="flex flex-wrap gap-3.5 text-xs text-muted">
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(viewCount)}</strong> 浏览</span>
      <span title={PLAY_COUNT_DESCRIPTION}><strong className="font-mono font-semibold text-foreground">{formatNumber(playerCount)}</strong> 游玩</span>
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(commentCount)}</strong> 条评论</span>
      <Link className="hover:text-primary hover:underline" to={collectionHref}><strong className="font-mono font-semibold text-foreground">{formatNumber(favoriteCount)}</strong> 人收藏</Link>
    </div>
  );
}
