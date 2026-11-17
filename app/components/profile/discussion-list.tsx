import type { UserDiscussionItem } from "@/lib/dto/forum/activity";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { Timestamp } from "@/app/components/ui/timestamp";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

export function DiscussionList({
  items,
  compact = false,
}: {
  items: UserDiscussionItem[];
  compact?: boolean;
}) {
  const t = useMessages();
  if (!items.length) return <AccountEmpty>{t("publicProfile.noDiscussions")}</AccountEmpty>;
  return (
    <ul className={`divide-y divide-border border-border ${compact ? "border-t" : "border-b"}`}>
      {items.map((item, index) => (
        <li
          className={`min-w-0 py-3 ${compact && index >= 2 ? "hidden sm:block" : ""}`}
          key={`${item.kind}-${item.id}`}
        >
          <Link
            className="wrap-anywhere font-semibold"
            to={item.href}
            prefetch="none"
          >
            {item.title}
          </Link>
          <p className="mt-1 line-clamp-2 wrap-anywhere text-[15px] text-muted">
            {item.snippet}
          </p>
          <p className="mb-0 mt-2 text-xs text-muted">
            {t(`publicProfile.activity.${item.kind}`)} ·{" "}
            <Timestamp value={item.createdAt} />
          </p>
        </li>
      ))}
    </ul>
  );
}
