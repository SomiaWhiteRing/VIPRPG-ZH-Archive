"use client";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { HeaderNavigation, type HeaderNavigationLink } from "@/app/components/header-navigation";
import { Label } from "@/app/components/ui/label";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronDown, Search, UserRound, Menu, X } from "lucide-react";
import Image from "next/image";
import { hasPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { formatUnreadCount } from "@/lib/format";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";

type Session = {
  displayName: string;
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
  { href: "/games", label: "游戏库" },
  { href: "/upload", label: "上传" },
];

const ADMIN_LINKS: Array<HeaderNavigationLink & {
  permission?: PermissionKey;
  bootstrapOnly?: boolean;
}> = [
  { href: "/admin", label: "仪表盘", exact: true, permission: "system.dashboard.read" },
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
    permission: "character.read_private",
  },
  { href: "/admin/tags", label: "标签", permission: "tag.read_private" },
  { href: "/admin/emojis", label: "站点表情", permission: "custom_emoji.manage" },
  { href: "/admin/users", label: "用户", permission: "user.read" },
  { href: "/admin/permissions", label: "权限", bootstrapOnly: true },
  {
    href: "/admin/maintenance",
    label: "维护",
    permission: "system.maintenance.run",
  },
  { href: "/admin/audit", label: "审计", permission: "audit.read" },
];

export function SiteHeaderNav({ session, loginLink }: Props) {
  const pathname = usePathname() ?? "/";
  const inAdmin = pathname.startsWith("/admin");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const visibleAdminLinks = ADMIN_LINKS.filter((link) => {
    if (!session) return false;
    if (link.bootstrapOnly) return session.isBootstrapAdmin;
    return link.permission ? hasPermissionKey(session.permissionKeys, link.permission) : true;
  });
  const visibleHeaderLinks = inAdmin ? visibleAdminLinks : PUBLIC_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 text-foreground shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-14 w-[min(1280px,calc(100vw-2rem))] items-center gap-2 py-1.5 sm:gap-4">
        <Link
          className="inline-flex shrink-0 items-center gap-2 font-extrabold tracking-wide"
          href={inAdmin ? "/admin" : "/"}
        >
          <Image
            alt=""
            aria-hidden
            className="size-8 object-contain [image-rendering:pixelated]"
            height={32}
            src="/icon/windI.png"
            width={32}
          />
          <span>{inAdmin ? "VIPRPG 控制台" : "VIPRPG.org"}</span>
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
            <Label className="sr-only" htmlFor="header-search">
              搜索作品
            </Label>
            <Input
              className="min-w-0 flex-1 rounded-none border-0 bg-transparent px-4 text-sm shadow-none outline-none placeholder:text-muted focus-visible:ring-0"
              id="header-search"
              name="q"
              placeholder="搜索作品"
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
          {session ? (
            <UserMenu inAdmin={inAdmin} session={session} />
          ) : (
            <>
              {/* 移动端搜索按钮 - 放在登录注册按钮左边 */}
              {!inAdmin ? (
                <Button
                  className="md:hidden"
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                  aria-label="搜索"
                  aria-expanded={mobileSearchOpen}
                >
                  <Search size={20} />
                </Button>
              ) : null}
              
              <Link
                className="inline-flex min-h-8 items-center rounded-md px-3 py-1.5 text-xs font-semibold hover:bg-muted/15"
                href="/register"
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
              <Label className="sr-only" htmlFor="mobile-search">
                搜索作品
              </Label>
              <Input
                className="min-w-0 flex-1 rounded-none border-0 bg-transparent px-4 text-sm shadow-none outline-none placeholder:text-muted focus-visible:ring-0"
                id="mobile-search"
                name="q"
                placeholder="搜索作品"
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

function UserMenu({ inAdmin, session }: { inAdmin: boolean; session: Session }) {
  const canAccessConsole = hasPermissionKey(session.permissionKeys, "system.dashboard.read");
  const itemClass =
    "flex min-h-9 w-full cursor-default items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm outline-none focus:bg-muted/15";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          aria-label={`${session.displayName} 用户菜单`}
          className="max-w-44 gap-1.5 px-2.5"
          size="sm"
          type="button"
          variant="ghost"
        >
          <UserRound aria-hidden />
          <span className="hidden max-w-28 truncate sm:inline">{session.displayName}</span>
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
            <Link className={itemClass} href="/me">
              个人中心
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link className={itemClass} href="/inbox">
              <span>站内信</span>
              {session.unread > 0 ? (
                <Badge className="min-h-5 px-1.5 text-[11px]" variant="negative">
                  {formatUnreadCount(session.unread)}
                </Badge>
              ) : null}
            </Link>
          </DropdownMenu.Item>
          {inAdmin ? (
            <DropdownMenu.Item asChild>
              <Link className={itemClass} href="/">
                返回站点
              </Link>
            </DropdownMenu.Item>
          ) : canAccessConsole ? (
            <DropdownMenu.Item asChild>
              <Link className={itemClass} href="/admin">
                控制台
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <form action="/api/auth/logout" method="post">
            <input name="next" type="hidden" value="/" />
            <DropdownMenu.Item asChild>
              <Button className="w-full justify-start rounded-sm px-2.5 font-normal" size="sm" type="submit" variant="ghost">
                登出
              </Button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
