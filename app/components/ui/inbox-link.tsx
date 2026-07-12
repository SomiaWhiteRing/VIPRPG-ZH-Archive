import Link from "next/link";
import { formatUnreadCount } from "@/lib/format";

type InboxLinkProps = {
  unread: number;
  variant?: "button" | "nav";
};

export function InboxLink({ unread, variant = "button" }: InboxLinkProps) {
  return (
    <Link
      className={`button inbox-link${variant === "nav" ? " inbox-link--nav" : ""}`}
      href="/inbox"
    >
      站内信
      {unread > 0 ? (
        <span className="notification-badge">{formatUnreadCount(unread)}</span>
      ) : null}
    </Link>
  );
}
