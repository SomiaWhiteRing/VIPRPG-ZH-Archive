import Link from "next/link";
import { formatUnreadCount } from "@/lib/format";
import { Badge } from "@/app/components/ui/badge";

type InboxLinkProps = {
  unread: number;
  variant?: "button" | "nav";
};

export function InboxLink({ unread, variant = "button" }: InboxLinkProps) {
  return (
    <Link
      className={`inline-flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold hover:bg-muted/15 ${variant === "button" ? "border border-border bg-card shadow-sm" : ""}`}
      href="/inbox"
    >
      站内信
      {unread > 0 ? (
        <Badge className="min-h-5 px-1.5 text-[11px]" variant="negative">
          {formatUnreadCount(unread)}
        </Badge>
      ) : null}
    </Link>
  );
}
