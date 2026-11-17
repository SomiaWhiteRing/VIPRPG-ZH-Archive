import { ACCOUNT_NAVIGATION, isAccountNavigationActive } from "@/lib/account-navigation";
import { cn } from "@/lib/ui/cn";
import { Fragment } from "react";
import { useInboxUnread } from "@/app/components/inbox-indicator";
import { UnreadBadge } from "@/app/components/ui/unread-badge";
import { useLocation } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

export function AccountNavigation({ canUpload }: { canUpload: boolean }) {
  const t = useMessages();
  const pathname = useLocation().pathname ?? "/me";
  const { messagesUnread } = useInboxUnread();
  const items = ACCOUNT_NAVIGATION.filter(
    (item) => !item.requiresUpload || canUpload,
  );

  const links = () =>
    items.map((item) => {
      const active = isAccountNavigationActive(item, pathname);
      return (
        <Fragment key={item.href}>
          {item.separatorBefore ? (
            <hr aria-hidden="true" className="my-1 border-border" />
          ) : null}
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap rounded-md text-sm transition-colors",
              "flex min-h-8 items-center px-3 py-1.5 pointer-coarse:min-h-11",
              active
                ? "bg-primary/10 font-semibold text-secondary"
                : "text-foreground hover:bg-muted/15",
              active && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-current",
            )}
            to={item.href}
          >
            {t(item.label)}
            {item.href === "/me/messages" ? <UnreadBadge className="ml-auto" count={messagesUnread} /> : null}
          </Link>
        </Fragment>
      );
    });

  return (
    <>
      <aside className="hidden md:block" aria-label={t("account.nav.label")}>
        <nav className="grid gap-0.5">{links()}</nav>
      </aside>
    </>
  );
}
