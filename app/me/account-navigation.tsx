import { ACCOUNT_NAVIGATION } from "@/lib/account-navigation";
import { cn } from "@/lib/ui/cn";
import { Fragment, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

export function AccountNavigation({ canUpload }: { canUpload: boolean }) {
  const pathname = useLocation().pathname ?? "/me";
  const mobileNavRef = useRef<HTMLElement>(null);
  const items = ACCOUNT_NAVIGATION.filter(
    (item) => !item.requiresUpload || canUpload,
  );

  useEffect(() => {
    mobileNavRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
  }, [pathname]);

  const links = (mobile: boolean) =>
    items.map((item) => {
      const active = item.exact
        ? pathname === item.href
        : pathname.startsWith(`${item.href}/`) || pathname === item.href;
      return (
        <Fragment key={item.href}>
          {!mobile && item.separatorBefore ? (
            <hr aria-hidden="true" className="my-1 border-border" />
          ) : null}
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap rounded-md text-sm transition-colors",
              mobile ? "px-3 py-2" : "flex min-h-8 items-center px-3 py-1.5 pointer-coarse:min-h-11",
              active
                ? "bg-primary/10 font-semibold text-secondary"
                : "text-foreground hover:bg-muted/15",
              !mobile && active && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-current",
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
        <nav className="grid gap-0.5">{links(false)}</nav>
      </aside>
      <nav
        aria-label="个人中心导航"
        className="sticky top-14 z-30 -mx-4 flex gap-1 overflow-x-auto border-y border-border bg-background/95 px-4 py-2 backdrop-blur md:hidden"
        ref={mobileNavRef}
      >
        {links(true)}
      </nav>
    </>
  );
}
