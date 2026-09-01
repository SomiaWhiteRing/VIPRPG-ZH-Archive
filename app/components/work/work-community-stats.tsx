import { formatNumber } from "@/lib/format";

export function WorkCommunityStats({
  commentCount,
  playerCount,
  viewCount,
}: {
  commentCount: number;
  playerCount: number;
  viewCount: number;
}) {
  return (
    <div aria-label="热度统计" className="flex flex-wrap gap-3.5 text-xs text-muted">
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(viewCount)}</strong> 浏览</span>
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(playerCount)}</strong> 位玩家</span>
      <span><strong className="font-mono font-semibold text-foreground">{formatNumber(commentCount)}</strong> 条评论</span>
    </div>
  );
}
