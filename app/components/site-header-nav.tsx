import type { HeaderNavigationLink } from "@/app/components/header-navigation";
import { HeaderNavigation } from "@/app/components/header-navigation";
import { InboxIndicator } from "@/app/components/inbox-indicator";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { formatUnreadCount } from "@/lib/format";
import { getPageSearchScope } from "@/lib/search";

import type { PermissionKey } from "@/lib/authz/permissions";
import {
  CHARACTER_ADMIN_PERMISSIONS,
  hasPermissionKey,
} from "@/lib/authz/permissions";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { Suspense, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

type Session = {
  id: number;
  displayName: string;
  avatarBlobSha256: string | null;
  unread: number;
  permissionKeys: PermissionKey[];
  isBootstrapAdmin: boolean;
};

type Props = {
  session: Session | null;
  loginLink: ReactNode;
};

const PUBLIC_LINKS: HeaderNavigationLink[] = [
  { href: "/", label: "首页", exact: true },
  { href: "/games", label: "作品库" },
  { href: "/characters", label: "角色" },
  { href: "/discussions", label: "讨论版" },
  { href: "/catalogs", label: "目录" },
  { href: "/resources", label: "资源" },
  { href: "/upload", label: "上传" },
];

const ADMIN_LINKS: Array<
  HeaderNavigationLink & {
    permission?: PermissionKey;
    anyPermission?: PermissionKey[];
    bootstrapOnly?: boolean;
  }
> = [
  {
    href: "/admin",
    label: "仪表盘",
    exact: true,
    permission: "system.dashboard.read",
  },
  { href: "/admin/works", label: "作品", permission: "work.read_private" },
  {
    href: "/admin/archive-versions",
    label: "版本管理",
    permission: "archive_version.read_private",
  },
  {
    href: "/admin/creators",
    label: "作者",
    permission: "creator.read_private",
  },
  {
    href: "/admin/characters",
    label: "角色",
    anyPermission: [...CHARACTER_ADMIN_PERMISSIONS],
  },
  { href: "/admin/tags", label: "标签", permission: "tag.read_private" },
  {
    href: "/admin/emojis",
    label: "默认表情",
    permission: "emoji.defaults.manage",
  },
  {
    href: "/admin/discussions",
    label: "讨论版",
    anyPermission: ["forum.content.moderate_any", "forum.topic.feature_any"],
  },
  {
    href: "/admin/discussion-tags",
    label: "讨论 TAG",
    permission: "forum.tag.manage",
  },
  { href: "/admin/users", label: "用户", permission: "user.read" },
  { href: "/admin/permissions", label: "权限", bootstrapOnly: true },
  { href: "/admin/resources", label: "资源", bootstrapOnly: true },
  {
    href: "/admin/maintenance",
    label: "维护",
    permission: "system.maintenance.run",
  },
  {
    href: "/admin/archive-versions/trash",
    label: "回收站",
    permission: "archive_version.restore",
  },
  { href: "/admin/audit", label: "审计", permission: "audit.read" },
];

function getAdminLinks(session: Session | null) {
  return ADMIN_LINKS.filter(
    (link) =>
      session &&
      (link.bootstrapOnly
        ? session.isBootstrapAdmin
        : link.anyPermission
          ? link.anyPermission.some((key) =>
              hasPermissionKey(session.permissionKeys, key),
            )
          : !link.permission ||
            hasPermissionKey(session.permissionKeys, link.permission)),
  );
}

export function SiteHeaderNav({ session, loginLink }: Props) {
  const { pathname, search } = useLocation();
  const [searchScope, searchLabel] = getPageSearchScope(pathname, search);
  const searchPlaceholder =
    searchScope === "discussions" ? "搜索讨论" : `搜索${searchLabel}`;
  const inAdmin = pathname.startsWith("/admin");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const visibleAdminLinks = getAdminLinks(session);
  const visibleHeaderLinks = inAdmin ? visibleAdminLinks : PUBLIC_LINKS;

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/95 text-foreground shadow-sm backdrop-blur"
      id="site-header"
    >
      <div className="mx-auto flex min-h-14 w-[min(1280px,calc(100vw-2rem))] items-center gap-2 py-1.5 sm:gap-4">
        <Link
          className="inline-flex shrink-0 items-center gap-2 font-extrabold tracking-wide"
          to={inAdmin ? (visibleAdminLinks[0]?.href ?? "/") : "/"}
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
          <span>{inAdmin ? "VIPRPG.org 控制台" : "VIPRPG.org"}</span>
        </Link>

        <HeaderNavigation
          ariaLabel={inAdmin ? "管理导航" : "站点导航"}
          links={visibleHeaderLinks}
          mobileAriaLabel={inAdmin ? "移动端管理导航" : "移动端导航"}
          mobileOpen={mobileMenuOpen}
          onMobileNavigate={() => setMobileMenuOpen(false)}
          pathname={pathname}
        />

        {/* 移动端汉堡按钮 */}
        <Button
          className="md:hidden"
          size="icon"
          variant="ghost"
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="菜单"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>

        {/* 桌面端搜索框 */}
        {!inAdmin ? (
          <form
            className="hidden md:flex h-10 w-[clamp(170px,18vw,260px)] overflow-hidden rounded-full border border-border bg-card focus-within:border-primary"
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
              aria-label="搜索"
              title="搜索"
              type="submit"
            >
              <Search size={17} aria-hidden />
            </Button>
          </form>
        ) : null}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* 移动端搜索按钮 */}
          {!inAdmin ? (
            <Button
              className="md:hidden"
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              aria-label={searchPlaceholder}
              aria-expanded={mobileSearchOpen}
            >
              <Search size={20} />
            </Button>
          ) : null}
          {session ? (
            <Suspense
              fallback={<UserMenu inAdmin={inAdmin} session={session} />}
            >
              <InboxIndicator key={session.id} initialUnread={session.unread}>
                {(unread) => (
                  <UserMenu
                    inAdmin={inAdmin}
                    session={{ ...session, unread }}
                  />
                )}
              </InboxIndicator>
            </Suspense>
          ) : (
            <>
              <Link
                className="inline-flex min-h-8 items-center rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-muted/15"
                to="/register"
              >
                注册
              </Link>
              {loginLink}
            </>
          )}
        </div>
      </div>

      {/* 移动端搜索浮层 */}
      {!inAdmin && mobileSearchOpen ? (
        <div className="fixed inset-x-0 top-14 z-50 border-b border-border bg-background shadow-lg md:hidden">
          <div className="mx-auto flex w-[min(1280px,calc(100vw-2rem))] items-center gap-2 py-2">
            <form
              className="flex h-10 flex-1 overflow-hidden rounded-full border border-border bg-card focus-within:border-primary"
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
                aria-label="搜索"
                type="submit"
              >
                <Search size={17} aria-hidden />
              </Button>
            </form>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              onClick={() => setMobileSearchOpen(false)}
              aria-label="关闭搜索"
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
  const consoleHref = getAdminLinks(session)[0]?.href;
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const itemClass =
    "flex min-h-9 w-full cursor-pointer data-[disabled]:cursor-not-allowed items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            aria-label={`${session.displayName} 用户菜单${session.unread > 0 ? `，${session.unread} 条未读提醒` : ""}`}
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
              {session.unread > 0 ? (
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
                个人中心
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link className={itemClass} to="/me/favorites">
                收藏
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link className={itemClass} to="/me/emojis">表情库</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link className={itemClass} to="/me/catalogs">
                我的目录
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild>
              <Link
                className={itemClass}
                to="/inbox"
                prefetch="none"
                aria-label={`提醒，${session.unread} 条未读`}
              >
                <span>提醒</span>
                {session.unread > 0 ? (
                  <Badge
                    className="min-h-5 px-1.5 text-[11px]"
                    variant="negative"
                  >
                    {formatUnreadCount(session.unread)}
                  </Badge>
                ) : null}
              </Link>
            </DropdownMenu.Item>
            {inAdmin ? (
              <DropdownMenu.Item asChild>
                <Link className={itemClass} to="/">
                  返回站点
                </Link>
              </DropdownMenu.Item>
            ) : consoleHref ? (
              <DropdownMenu.Item asChild>
                <Link className={itemClass} to={consoleHref}>
                  控制台
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={itemClass}
              onSelect={(event) => {
                event.preventDefault();
                logoutFormRef.current?.requestSubmit();
              }}
            >
              登出
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <form
        action="/api/auth/logout"
        className="hidden"
        method="post"
        ref={logoutFormRef}
      >
        <input name="next" type="hidden" value="/" />
      </form>
    </>
  );
}
