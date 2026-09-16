import type { UserDiscussionItem } from "@/lib/dto/forum/activity";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { formatDate } from "@/lib/format";
import { Link } from "react-router";

const activityLabels = { topic: "发帖", post: "回帖", comment: "楼中楼回复" };

export function DiscussionList({
  items,
  compact = false,
}: {
  items: UserDiscussionItem[];
  compact?: boolean;
}) {
  if (!items.length) return <AccountEmpty>还没有可展示的讨论。</AccountEmpty>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map((item, index) => (
        <li
          className={`min-w-0 py-3 ${compact && index >= 2 ? "hidden sm:block" : ""}`}
          key={`${item.kind}-${item.id}`}
        >
          <Link
            className="break-words font-semibold"
            to={item.href}
            prefetch="none"
          >
            {item.title}
          </Link>
          <p className="mt-1 line-clamp-2 break-words text-sm text-muted">
            {item.snippet}
          </p>
          <p className="mb-0 mt-2 text-xs text-muted">
            {activityLabels[item.kind]} ·{" "}
            <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
          </p>
        </li>
      ))}
    </ul>
  );
}
