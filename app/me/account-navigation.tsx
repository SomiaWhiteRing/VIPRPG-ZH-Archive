"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ACCOUNT_NAVIGATION } from "@/lib/account-navigation";
import { cn } from "@/lib/ui/cn";

export function AccountNavigation({ canUpload }: { canUpload: boolean }) {
  const pathname = usePathname() ?? "/me";
  const mobileNavRef = useRef<HTMLElement>(null);
  const items = ACCOUNT_NAVIGATION.filter((item) => !item.requiresUpload || canUpload);

  useEffect(() => {
    mobileNavRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [pathname]);

  const links = (mobile: boolean) =>
    items.map((item) => {
      const active = item.exact ? pathname === item.href : pathname.startsWith(`${item.href}/`) || pathname === item.href;
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-md text-sm font-semibold transition-colors",
            mobile ? "px-3 py-2" : "block px-3 py-2.5",
            active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted/15",
          )}
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      );
    });

  return (
    <>
      <aside className="sticky top-20 hidden self-start md:block" aria-label="个人中心导航">
        <nav className="grid gap-1">{links(false)}</nav>
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
