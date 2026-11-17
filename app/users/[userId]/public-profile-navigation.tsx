import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";
import { cn } from "@/lib/ui/cn";
import type { ProfileVisibility } from "@/lib/user-profile";
import { useLocation } from "react-router";

export function PublicProfileNavigation({
  userId,
  visibility,
}: {
  userId: number;
  visibility: ProfileVisibility;
}) {
  const t = useMessages();
  const pathname = useLocation().pathname ?? "";
  const base = `/users/${userId}`;
  const links: Array<{ href: string; label: string; exact?: boolean }> = [
    { href: base, label: t("account.nav.overview"), exact: true },
    { href: `${base}/timeline`, label: t("timeline.settings.title") },
    ...(visibility.favorites
      ? [{ href: `${base}/favorites`, label: t("timeline.feed.kind.favorite") }]
      : []),
    ...(visibility.history
      ? [{ href: `${base}/history`, label: t("publicProfile.history") }]
      : []),
    ...(visibility.catalogs
      ? [{ href: `${base}/catalogs`, label: t("timeline.feed.kind.catalog") }]
      : []),
    ...(visibility.comments
      ? [{ href: `${base}/comments`, label: t("timeline.feed.kind.comment") }]
      : []),
    ...(visibility.discussions
      ? [{ href: `${base}/discussions`, label: t("publicProfile.discussionTab") }]
      : []),
    ...(visibility.friends
      ? [{ href: `${base}/connections`, label: t("friends.title") }]
      : []),
  ];
  return (
    <nav
      aria-label={t("publicProfile.navigation")}
      className="flex gap-1 overflow-x-auto border-b border-border py-2"
    >
      {links.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold",
              active
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/15",
            )}
            to={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
