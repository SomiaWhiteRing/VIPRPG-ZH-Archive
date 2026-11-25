import type {
  HeaderNavigationEntry,
  HeaderNavigationLink,
} from "@/app/components/header-navigation";
import { HeaderNavigation } from "@/app/components/header-navigation";
import { useInboxUnread } from "@/app/components/inbox-indicator";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { UnreadBadge } from "@/app/components/ui/unread-badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { getPageSearchScope, searchScopeLabel } from "@/lib/search";
import { ACCOUNT_SHORTCUTS, type AccountPreferences } from "@/lib/account-preferences";
import { canAccessOwnWorks } from "@/lib/authz/permissions";

import type { PermissionKey } from "@/lib/authz/permissions";
import {
  CHARACTER_ADMIN_PERMISSIONS,
  hasPermissionKey,
} from "@/lib/authz/permissions";
import { ChevronDown, Search, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import type { MessageKey } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { RedirectForm } from "@/app/components/ui/redirect-form";

type Session = {
  id: number;
  displayName: string;
  avatarBlobSha256: string | null;
  permissionKeys: PermissionKey[];
  isBootstrapAdmin: boolean;
  preferences: AccountPreferences;
};

type Props = {
  session: Session | null;
  loginLink: ReactNode;
};

const PUBLIC_LINKS: (Omit<HeaderNavigationLink, "label"> & { label: MessageKey })[] = [
  { href: "/", label: "core.nav.home", exact: true },
  { href: "/games", label: "core.nav.games" },
  { href: "/characters", label: "core.nav.characters" },
  { href: "/discussions", label: "core.nav.discussions" },
  { href: "/timeline", label: "core.nav.timeline" },
  { href: "/rakuen", label: "core.nav.rakuen" },
  { href: "/catalogs", label: "core.nav.catalogs" },
  { href: "/resources", label: "core.nav.resources" },
  { href: "/upload", label: "core.nav.upload" },
];

type AdminNavigationLink = Omit<HeaderNavigationLink, "label"> & {
  label: MessageKey;
  permission?: PermissionKey;
  anyPermission?: PermissionKey[];
  bootstrapOnly?: boolean;
};

const ADMIN_NAVIGATION: Array<
  AdminNavigationLink | { label: MessageKey; links: AdminNavigationLink[] }
> = [
  {
    href: "/admin",
    label: "admin.nav.dashboard",
    exact: true,
    permission: "system.dashboard.read",
  },
  {
    label: "admin.nav.workData",
    links: [
      { href: "/admin/works", label: "search.scopes.works", permission: "work.read_private" },
      { href: "/admin/home-recommendations", label: "home.recommended", bootstrapOnly: true },
      {
        href: "/admin/archive-versions",
        label: "admin.nav.versions",
        permission: "archive_version.read_private",
      },
      {
        href: "/admin/creators",
        label: "search.scopes.creators",
        permission: "creator.read_private",
      },
      {
        href: "/admin/characters",
        label: "core.nav.characters",
        anyPermission: [...CHARACTER_ADMIN_PERMISSIONS],
      },
      { href: "/admin/tags", label: "library.tags", permission: "tag.read_private" },
      { href: "/admin/genres", label: "work.sidebar.genre", permission: "genre.manage" },
      {
        href: "/admin/archive-versions/trash",
        label: "admin.nav.trash",
        permission: "archive_version.restore",
      },
    ],
  },
  {
    label: "admin.nav.community",
    links: [
      {
        href: "/admin/discussions",
        label: "core.nav.discussions",
        anyPermission: ["forum.content.moderate_any", "forum.topic.feature_any", "forum.topic.sage_any"],
      },
      {
        href: "/admin/discussion-tags",
        label: "admin.nav.forumTags",
        permission: "forum.tag.manage",
      },
      {
        href: "/admin/emojis",
        label: "admin.nav.defaultEmojis",
        permission: "emoji.defaults.manage",
      },
    ],
  },
  {
    label: "admin.nav.userPermissions",
    links: [
      { href: "/admin/users", label: "admin.nav.users", permission: "user.read" },
      { href: "/admin/permissions", label: "admin.nav.permissions", bootstrapOnly: true },
    ],
  },
  {
    label: "admin.nav.maintenanceGroup",
    links: [
      { href: "/admin/resources", label: "core.nav.resources", bootstrapOnly: true },
      {
        href: "/admin/maintenance",
        label: "admin.nav.maintenance",
        permission: "system.maintenance.run",
      },
      { href: "/admin/audit", label: "admin.nav.audit", permission: "audit.read" },
    ],
  },
];

function getAdminNavigation(session: Session | null, t: ReturnType<typeof useMessages>): HeaderNavigationEntry[] {
  if (!session) return [];

  const canAccess = (link: AdminNavigationLink) =>
    link.bootstrapOnly
      ? session.isBootstrapAdmin
      : link.anyPermission
        ? link.anyPermission.some((key) =>
            hasPermissionKey(session.permissionKeys, key),
          )
        : !link.permission ||
          hasPermissionKey(session.permissionKeys, link.permission);

  return ADMIN_NAVIGATION.flatMap<HeaderNavigationEntry>((entry) => {
    if (!("links" in entry)) return canAccess(entry) ? [{ ...entry, label: t(entry.label) }] : [];
    const links = entry.links.filter(canAccess).map((link) => ({ ...link, label: t(link.label) }));
    return links.length ? [{ label: t(entry.label), links }] : [];
  });
}

function getAdminLandingHref(entries: HeaderNavigationEntry[]) {
  const first = entries[0];
  return first && ("links" in first ? first.links[0]?.href : first.href);
}

export function SiteHeaderNav({ session, loginLink }: Props) {
  const locale = useNavigationLocale();
  const t = useMessages();
  const { pathname, search } = useLocation();
  const uiLocale = useUiLocale();
  const [searchScope] = getPageSearchScope(pathname, search);
  const searchPlaceholder =
    searchScope === "discussions" ? t("header.searchDiscussions") : t("header.searchScope", { scope: searchScopeLabel(searchScope, uiLocale) });
  const inAdmin = pathname.startsWith("/admin");
  const [openPanel, setOpenPanel] = useState<"menu" | "search" | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const menuOpen = openPanel === "menu";
  const mobileSearchOpen = openPanel === "search";
  const visibleAdminEntries = getAdminNavigation(session, t);
  const publicLinks = PUBLIC_LINKS.map((link) =>
    session?.preferences.timelineAsHomepage && link.href === "/timeline"
      ? { href: "/explore", label: t("core.nav.explore") }
      : { ...link, label: t(link.label) },
  );

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const updateHeight = () => {
      root.style.setProperty("--site-header-height", `${header.getBoundingClientRect().height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--site-header-height");
    };
  }, []);

  useEffect(() => {
    setOpenPanel(null);
  }, [pathname, search]);

  useEffect(() => {
    if (!openPanel) return;

    const breakpoint = openPanel === "search" ? window.matchMedia("(min-width: 48rem)") : null;
    const closeAtBreakpoint = () => {
      if (breakpoint?.matches) setOpenPanel(null);
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !headerRef.current?.contains(event.target)
      ) {
        setOpenPanel(null);
      }
    };
    closeAtBreakpoint();
    breakpoint?.addEventListener("change", closeAtBreakpoint);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      breakpoint?.removeEventListener("change", closeAtBreakpoint);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [openPanel]);

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/95 text-foreground shadow-sm backdrop-blur"
      id="site-header"
      ref={headerRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || !openPanel) return;
        event.preventDefault();
        (menuOpen ? menuButtonRef : searchButtonRef).current?.focus();
        setOpenPanel(null);
      }}
    >
      <div className="mx-auto flex min-h-14 w-max min-w-[min(1280px,calc(100%-2rem))] max-w-[calc(100%-2rem)] items-center gap-2 py-1.5 sm:gap-4">
        <Link
          className="inline-flex shrink-0 items-center gap-2 font-extrabold tracking-wide"
          to={inAdmin ? (getAdminLandingHref(visibleAdminEntries) ?? "/") : "/"}
        >
          <img
            alt=""
            aria-hidden
            className="size-8 object-contain [image-rendering:pixelated]"
            height={32}
            src="/icon/windI.png"
            width={32}
            loading="lazy"
          />
          <span className="sr-only min-[360px]:not-sr-only">
            VIPRPG.org
            {inAdmin ? <span className="hidden sm:inline">{" "}{t("header.console")}</span> : null}
          </span>
        </Link>

        <HeaderNavigation
          ariaLabel={inAdmin ? t("header.adminNav") : t("header.siteNav")}
          entries={inAdmin ? visibleAdminEntries : publicLinks}
          overflowAriaLabel={inAdmin ? t("header.overflowAdminNav") : t("header.overflowNav")}
          overflowOpen={menuOpen}
          menuButtonRef={menuButtonRef}
          menuButtonLabel={menuOpen ? t("header.closeMenu") : t("header.openMenu")}
          onToggleMenu={() => setOpenPanel(menuOpen ? null : "menu")}
          onCloseMenu={() => setOpenPanel(null)}
          pathname={pathname}
          overflowFooter={
            !session ? (
              <Link
                className="block border-t border-border/50 px-3 py-2.5 text-sm font-semibold hover:bg-muted/15 sm:hidden"
                to="/register"
                onClick={() => setOpenPanel(null)}
              >
                {t("auth.register")}
              </Link>
            ) : null
          }
        />

        {/* 中等宽度起保留完整搜索框。 */}
        {!inAdmin ? (
          <form
            className="hidden h-10 w-[260px] shrink-0 overflow-hidden rounded-full border border-border bg-card focus-within:border-primary md:flex"
            action="/search"
            method="get"
            role="search"
          >
            <input name="scope" type="hidden" value={searchScope} />
            <Label className="sr-only" htmlFor="header-search">
              {searchPlaceholder}
            </Label>
            <Input
              className="min-w-0 flex-1 rounded-none border-0 bg-transparent px-4 text-sm shadow-none outline-none placeholder:text-muted focus-visible:ring-0"
              id="header-search"
              name="q"
              placeholder={searchPlaceholder}
              type="search"
            />
            <Button
              className="grid w-10 shrink-0 place-items-center rounded-none border-l border-border bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("search.submit")}
              title={t("search.submit")}
              type="submit"
            >
              <Search size={17} aria-hidden />
            </Button>
            {locale && <input type="hidden" name={UI_LOCALE_PARAM} value={locale} />}
          </form>
        ) : null}

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* 移动端搜索按钮 */}
          {!inAdmin ? (
            <Button
              className="md:hidden"
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => setOpenPanel(mobileSearchOpen ? null : "search")}
              aria-label={searchPlaceholder}
              aria-controls={mobileSearchOpen ? "mobile-search-panel" : undefined}
              aria-expanded={mobileSearchOpen}
              ref={searchButtonRef}
            >
              <Search size={20} />
            </Button>
          ) : null}
          {session ? (
            <UserMenu inAdmin={inAdmin} session={session} />
          ) : (
            <>
              <Link
                className="hidden min-h-8 items-center rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-muted/15 sm:inline-flex"
                to="/register"
              >
                {t("auth.signUp")}
              </Link>
              {loginLink}
            </>
          )}
        </div>
      </div>

      {/* 移动端搜索浮层 */}
      {!inAdmin && mobileSearchOpen ? (
        <div
          className="absolute inset-x-0 top-full z-50 border-b border-border bg-background shadow-lg md:hidden"
          id="mobile-search-panel"
        >
          <div className="mx-auto flex w-[min(1280px,calc(100vw-2rem))] items-center gap-2 py-2">
            <form
              className="flex h-10 min-w-0 flex-1 overflow-hidden rounded-full border border-border bg-card focus-within:border-primary"
              action="/search"
              method="get"
              role="search"
            >
              <input name="scope" type="hidden" value={searchScope} />
              <Label className="sr-only" htmlFor="mobile-search">
                {searchPlaceholder}
              </Label>
              <Input
                className="min-w-0 flex-1 rounded-none border-0 bg-transparent px-4 text-sm shadow-none outline-none placeholder:text-muted focus-visible:ring-0"
                id="mobile-search"
                name="q"
                placeholder={searchPlaceholder}
                type="search"
                autoFocus
              />
              <Button
                className="grid w-10 shrink-0 place-items-center rounded-none border-l border-border bg-primary text-primary-foreground hover:bg-primary/90"
                aria-label={t("search.submit")}
                type="submit"
              >
                <Search size={17} aria-hidden />
              </Button>
              {locale && <input type="hidden" name={UI_LOCALE_PARAM} value={locale} />}
            </form>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => {
                setOpenPanel(null);
                searchButtonRef.current?.focus();
              }}
              aria-label={t("header.closeSearch")}
            >
              <X size={20} />
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function UserMenu({
  inAdmin,
  session,
}: {
  inAdmin: boolean;
  session: Session;
}) {
  const t = useMessages();
  const environment = useClientEnvironment();
  const { unread, messagesUnread } = useInboxUnread();
  const consoleHref = getAdminLandingHref(getAdminNavigation(session, t));
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const itemClass =
    "flex min-h-9 w-full cursor-pointer data-[disabled]:cursor-not-allowed items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15";

  return (
    <>
      <DropdownMenu.Root onOpenChange={(open) => { if (open) notifyInboxChanged(); }}>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={t("header.accountMenu", { name: session.displayName, unread: unread + messagesUnread })}
            className="max-w-44 gap-1.5 px-2.5"
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="relative inline-flex size-6 shrink-0">
              <UserAvatar
                avatarBlobSha256={session.avatarBlobSha256}
                className="size-6"
                displayName={session.displayName}
                size={24}
              />
              {unread > 0 || messagesUnread > 0 ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-background"
                />
              ) : null}
            </span>
            <span className="hidden max-w-28 truncate sm:inline">
              {session.displayName}
            </span>
            <ChevronDown aria-hidden className="hidden text-muted sm:block" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-48 rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
            sideOffset={8}
          >
            <DropdownMenu.Item asChild>
              <Link className={itemClass} to="/me">
                <span>{t("header.me")}</span>
                {!session.preferences.shortcuts.includes("/me/messages") ? <UnreadBadge count={messagesUnread} /> : null}
              </Link>
            </DropdownMenu.Item>
            {session.preferences.shortcuts.map((href) => {
              const item = ACCOUNT_SHORTCUTS.find((entry) => entry.href === href);
              if (!item || (item.requiresUpload && !canAccessOwnWorks({ status: "active", permissionKeys: session.permissionKeys }))) return null;
              return (
                <DropdownMenu.Item asChild key={href}>
                  <Link className={itemClass} to={href}>
                    <span>{t(item.label)}</span>
                    {href === "/me/messages" ? <UnreadBadge count={messagesUnread} /> : null}
                  </Link>
                </DropdownMenu.Item>
              );
            })}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild>
              <Link
                className={itemClass}
                to="/inbox"
                prefetch="none"
                aria-label={t("header.inboxUnread", { count: unread })}
              >
                <span>{t("header.inbox")}</span>
                <UnreadBadge count={unread} />
              </Link>
            </DropdownMenu.Item>
            {environment === "browser" ? (
              <DropdownMenu.Item asChild>
                <Link className={itemClass} to="/installed" prefetch="none">{t("header.installed")}</Link>
              </DropdownMenu.Item>
            ) : null}
            {inAdmin ? (
              <DropdownMenu.Item asChild>
                <Link className={itemClass} to="/">
                  {t("header.back")}
                </Link>
              </DropdownMenu.Item>
            ) : consoleHref ? (
              <DropdownMenu.Item asChild>
                <Link className={itemClass} to={consoleHref}>
                  {t("header.console")}
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={itemClass}
              disabled={logoutBusy}
              onSelect={(event) => {
                event.preventDefault();
                logoutFormRef.current?.requestSubmit();
              }}
            >
              {t("header.logout")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <RedirectForm
        action="/api/auth/logout"
        preserveLanguage
        className="hidden"
        method="post"
        onBusyChange={setLogoutBusy}
        ref={logoutFormRef}
      >
        <input name="next" type="hidden" value="/" />
      </RedirectForm>
    </>
  );
}
