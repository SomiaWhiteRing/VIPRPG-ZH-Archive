import { Button } from "@/app/components/ui/button";
import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export type HeaderNavigationLink = {
  href: string;
  label: string;
  exact?: boolean;
};

export type HeaderNavigationGroup = {
  label: string;
  links: HeaderNavigationLink[];
};

export type HeaderNavigationEntry = HeaderNavigationLink | HeaderNavigationGroup;

type HeaderNavigationProps = {
  ariaLabel: string;
  mobileAriaLabel: string;
  entries: HeaderNavigationEntry[];
  pathname: string;
  mobileOpen: boolean;
  onMobileNavigate: () => void;
  mobileFooter?: ReactNode;
};

export function HeaderNavigation({
  ariaLabel,
  mobileAriaLabel,
  entries,
  pathname,
  mobileOpen,
  onMobileNavigate,
  mobileFooter,
}: HeaderNavigationProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const openGroupRef = useRef(openGroup);

  useEffect(() => {
    openGroupRef.current = openGroup;
  }, [openGroup]);

  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  useEffect(() => {
    if (!openGroup) return;
    const breakpoint = window.matchMedia("(min-width: 64rem)");
    const closeOnCollapse = () => {
      if (!breakpoint.matches) setOpenGroup(null);
    };
    closeOnCollapse();
    breakpoint.addEventListener("change", closeOnCollapse);
    return () => breakpoint.removeEventListener("change", closeOnCollapse);
  }, [openGroup]);

  // Prefer the most specific route, e.g. the trash instead of version management.
  const activeHref = entries
    .flatMap((entry) => ("links" in entry ? entry.links : [entry]))
    .filter((link) =>
      link.exact
        ? pathname === link.href
        : pathname === link.href || pathname.startsWith(link.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      <nav
        aria-label={ariaLabel}
        className="hidden min-w-0 flex-1 items-center gap-1 lg:flex"
      >
        {entries.map((entry) =>
          "links" in entry ? (
            <DropdownMenu.Root
              key={entry.label}
              modal={false}
              open={openGroup === entry.label}
              onOpenChange={(open) => {
                setOpenGroup((current) => {
                  if (open) return entry.label;
                  // A previous menu may dismiss after the next one opens.
                  return current === entry.label ? null : current;
                });
              }}
            >
              <DropdownMenu.Trigger asChild>
                <Button
                  className={`gap-1 px-3 ${
                    entry.links.some((link) => link.href === activeHref)
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "data-[state=open]:bg-muted/15"
                  }`}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {entry.label}
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  aria-label={entry.label}
                  className="z-50 hidden max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded-md border border-border bg-card p-1 text-foreground shadow-surface lg:block"
                  collisionPadding={16}
                  onCloseAutoFocus={(event) => {
                    // Radix restores focus asynchronously after unmounting.
                    if (
                      openGroupRef.current !== null &&
                      openGroupRef.current !== entry.label
                    ) {
                      event.preventDefault();
                    }
                  }}
                  sideOffset={8}
                >
                  {entry.links.map((link) => (
                    <HeaderNavigationItem
                      key={link.href}
                      active={link.href === activeHref}
                      layout="dropdown"
                      link={link}
                    />
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <HeaderNavigationItem
              key={entry.href}
              active={entry.href === activeHref}
              link={entry}
            />
          ),
        )}
      </nav>
      {mobileOpen ? (
        <nav
          aria-label={mobileAriaLabel}
          className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-border bg-background shadow-lg lg:hidden"
          id="mobile-navigation"
        >
          <div className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-2">
            {entries.map((entry) =>
              "links" in entry ? (
                <section
                  key={entry.label}
                  aria-label={entry.label}
                  className="border-t border-border/50 py-2 first:border-t-0"
                >
                  <p className="px-3 py-1 text-xs font-semibold text-muted">
                    {entry.label}
                  </p>
                  <div>
                    {entry.links.map((link) => (
                      <HeaderNavigationItem
                        key={link.href}
                        active={link.href === activeHref}
                        layout="mobile"
                        link={link}
                        onNavigate={onMobileNavigate}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <HeaderNavigationItem
                  key={entry.href}
                  active={entry.href === activeHref}
                  layout="mobile"
                  link={entry}
                  onNavigate={onMobileNavigate}
                />
              ),
            )}
            {mobileFooter}
          </div>
        </nav>
      ) : null}
    </>
  );
}

function HeaderNavigationItem({
  active,
  link,
  layout = "desktop",
  onNavigate,
}: {
  active: boolean;
  link: HeaderNavigationLink;
  layout?: "desktop" | "mobile" | "dropdown";
  onNavigate?: () => void;
}) {
  const layoutClass = {
    desktop:
      "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3",
    mobile: "block border-t border-border/50 px-3 py-2.5 first:border-t-0",
    dropdown:
      "flex min-h-9 cursor-pointer items-center rounded-sm px-2.5 py-2 outline-none",
  }[layout];
  const className = `${layoutClass} text-sm font-semibold ${
    active
      ? "bg-primary text-primary-foreground"
      : "hover:bg-muted/15 focus-visible:bg-muted/15 data-[highlighted]:bg-muted/15"
  }`;

  const item = (
    <Link
      aria-current={active ? "page" : undefined}
      className={className}
      to={link.href}
      onClick={onNavigate}
    >
      {link.label}
    </Link>
  );

  return layout === "dropdown" ? (
    <DropdownMenu.Item asChild>{item}</DropdownMenu.Item>
  ) : item;
}
