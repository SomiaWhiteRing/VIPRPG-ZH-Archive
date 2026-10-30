import { Badge } from "@/app/components/ui/badge";
import { formatUnreadCount } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  return count > 0 ? <Badge className={cn("min-h-5 px-1.5 text-[11px]", className)} variant="negative">{formatUnreadCount(count)}</Badge> : null;
}
