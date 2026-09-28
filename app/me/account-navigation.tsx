import { ACCOUNT_NAVIGATION, isAccountNavigationActive } from "@/lib/account-navigation";
import { cn } from "@/lib/ui/cn";
import { Fragment } from "react";
import { Link, useLocation } from "react-router";

export function AccountNavigation({ canUpload }: { canUpload: boolean }) {
  const pathname = useLocation().pathname ?? "/me";
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
            {item.label}
          </Link>
        </Fragment>
      );
    });

  return (
    <>
      <aside className="hidden md:block" aria-label="个人中心导航">
        <nav className="grid gap-0.5">{links()}</nav>
      </aside>
    </>
  );
}
