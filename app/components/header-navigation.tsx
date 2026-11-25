import { Button } from "@/app/components/ui/button";
import { ChevronDown, Menu, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode, Ref } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

const desktopNavigationClassName =
  "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium";
const desktopGroupClassName = `${desktopNavigationClassName} gap-1`;

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
  overflowAriaLabel: string;
  entries: HeaderNavigationEntry[];
  pathname: string;
  overflowOpen: boolean;
  menuButtonRef: Ref<HTMLButtonElement>;
  menuButtonLabel: string;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  overflowFooter?: ReactNode;
};

export function HeaderNavigation({
  ariaLabel,
  overflowAriaLabel,
  entries,
  pathname,
  overflowOpen,
  menuButtonRef,
  menuButtonLabel,
  onToggleMenu,
  onCloseMenu,
  overflowFooter,
}: HeaderNavigationProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [fitsInline, setFitsInline] = useState<boolean | null>(null);
  const openGroupRef = useRef(openGroup);
  const slotRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const showInline = entries.length > 0 && fitsInline !== false;
  const showMenu = entries.length > 0 && fitsInline !== true;
  const groupIsInline = showInline && entries.some((entry) => "links" in entry && entry.label === openGroup);

  useEffect(() => {
    openGroupRef.current = openGroup;
  }, [openGroup]);

  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const row = measureRef.current;
    if (!slot || !row) return;

    // Measure the complete row independently of which entries are displayed.
    const fit = () => {
      setFitsInline(row.getBoundingClientRect().width <= slot.getBoundingClientRect().width);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(slot);
    observer.observe(row);
    return () => observer.disconnect();
  }, [entries]);

  useEffect(() => {
    if (openGroup && !groupIsInline) setOpenGroup(null);
    if (overflowOpen && !showMenu) onCloseMenu();
  }, [groupIsInline, onCloseMenu, openGroup, overflowOpen, showMenu]);

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
    <div className="grid min-w-10 flex-auto grid-cols-[minmax(0,1fr)] items-center" ref={slotRef}>
      <div aria-hidden className="pointer-events-none invisible col-start-1 row-start-1 overflow-hidden">
        <div className="flex w-max items-center gap-1" ref={measureRef}>
          {entries.map((entry) =>
            "links" in entry ? (
              <Button asChild className={desktopGroupClassName} key={entry.label} variant="ghost">
                <span>{entry.label}<ChevronDown aria-hidden /></span>
              </Button>
            ) : (
              <span className={desktopNavigationClassName} key={entry.href}>{entry.label}</span>
            ),
          )}
        </div>
      </div>
      <nav aria-label={ariaLabel} className="col-start-1 row-start-1 flex items-center">
        {showInline && (
          <div className={`items-center gap-1 ${fitsInline === null ? "hidden xl:flex" : "flex"}`}>
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
                      className={`${desktopGroupClassName} ${
                        entry.links.some((link) => link.href === activeHref)
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "data-[state=open]:bg-muted/15"
                      }`}
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
                      className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
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
          </div>
        )}
        {showMenu && (
          <Button
            className={fitsInline === null ? "xl:hidden" : undefined}
            size="icon"
            variant="ghost"
            type="button"
            onClick={onToggleMenu}
            aria-label={menuButtonLabel}
            aria-controls={overflowOpen ? "mobile-navigation" : undefined}
            aria-expanded={overflowOpen}
            ref={menuButtonRef}
          >
            {overflowOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        )}
      </nav>
      {overflowOpen && showMenu ? (
        <nav
          aria-label={overflowAriaLabel}
          className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-border bg-background shadow-lg"
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
                        onNavigate={onCloseMenu}
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
                  onNavigate={onCloseMenu}
                />
              ),
            )}
            {overflowFooter}
          </div>
        </nav>
      ) : null}
    </div>
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
    desktop: desktopNavigationClassName,
    mobile: "block border-t border-border/50 px-3 py-2.5 text-sm font-semibold first:border-t-0",
    dropdown:
      "flex min-h-9 cursor-pointer items-center rounded-sm px-2.5 py-2 text-sm font-semibold outline-none",
  }[layout];
  const className = `${layoutClass} ${
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
