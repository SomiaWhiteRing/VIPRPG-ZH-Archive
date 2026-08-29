"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type HeaderNavigationLink = {
  href: string;
  label: string;
  exact?: boolean;
};

type HeaderNavigationProps = {
  ariaLabel: string;
  mobileAriaLabel: string;
  links: HeaderNavigationLink[];
  pathname: string;
  mobileOpen: boolean;
  onMobileNavigate: () => void;
};

export function HeaderNavigation({
  ariaLabel,
  mobileAriaLabel,
  links,
  pathname,
  mobileOpen,
  onMobileNavigate,
}: HeaderNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    navigationRef.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <>
      <nav
        aria-label={ariaLabel}
        className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex scrollbar-thin"
        ref={navigationRef}
      >
        {links.map((link) => (
          <HeaderNavigationItem key={link.href} link={link} pathname={pathname} />
        ))}
      </nav>
      {mobileOpen ? (
        <nav
          aria-label={mobileAriaLabel}
          className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-border bg-background shadow-lg md:hidden"
        >
          <div className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-2">
            {links.map((link) => (
              <HeaderNavigationItem
                key={link.href}
                link={link}
                mobile
                onNavigate={onMobileNavigate}
                pathname={pathname}
              />
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}

function HeaderNavigationItem({
  link,
  mobile = false,
  onNavigate,
  pathname,
}: {
  link: HeaderNavigationLink;
  mobile?: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const active = link.exact
    ? pathname === link.href
    : pathname === link.href || pathname.startsWith(link.href + "/");
  const className = mobile
    ? `block border-t border-border/50 px-3 py-2.5 text-sm font-semibold first:border-t-0 ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted/15"
      }`
    : `inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-sm font-semibold ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted/15"
      }`;

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={className}
      href={link.href}
      onClick={onNavigate}
    >
      {link.label}
    </Link>
  );
}
