"use client";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronDown, Search, UserRound, Menu, X } from "lucide-react";
import Image from "next/image";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { hasPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { useState } from "react";

type Session = {
  displayName: string;
  unread: number;
  permissionKeys: PermissionKey[];
  isBootstrapAdmin: boolean;
};

type Props = {
  session: Session | null;
  logout: ReactNode;
  loginLink: ReactNode;
};

const LIBRARY_LINKS = [
  { href: "/games", label: "全部游戏" },
  { href: "/creators", label: "作者" },
  { href: "/characters", label: "角色" },
  { href: "/tags", label: "标签" },
  { href: "/catalogs", label: "目录" },
];

const ADMIN_LINKS: Array<{
  href: string;
  label: string;
  permission: PermissionKey;
}> = [
  { href: "/admin", label: "仪表盘", permission: "system.dashboard.read" },
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
  { href: "/admin/users", label: "用户", permission: "user.read" },
  {
    href: "/admin/maintenance",
    label: "维护",
    permission: "system.maintenance.run",
  },
];

export function SiteHeaderNav({ session, logout, loginLink }: Props) {
  const pathname = usePathname() ?? "/";
  const inAdmin = pathname.startsWith("/admin");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 text-foreground shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-14 w-[min(1180px,calc(100vw-2rem))] items-center gap-2 py-1.5 sm:gap-4">
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
        
        {/* 桌面端导航 */}
        <nav
          className="hidden flex-1 items-center gap-1 md:flex"
          aria-label={inAdmin ? "管理导航" : "站点导航"}
        >
          {inAdmin ? (
            <>
              {ADMIN_LINKS.filter((link) => session && hasPermissionKey(session.permissionKeys, link.permission)).map(
                (link) => (
                  <NavLink key={link.href} pathname={pathname} {...link} />
                ),
              )}
              {session?.isBootstrapAdmin ? (
                <NavLink href="/admin/permissions" label="权限" pathname={pathname} />
              ) : null}
              {session && hasPermissionKey(session.permissionKeys, "audit.read") ? (
                <NavLink href="/admin/audit" label="审计" pathname={pathname} />
              ) : null}
            </>
          ) : (
            <>
              <NavLink href="/" label="首页" pathname={pathname} />
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger className="inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-3 text-sm font-semibold hover:border-border hover:bg-card data-[state=open]:border-border data-[state=open]:bg-card">
                  游戏库 <ChevronDown size={15} aria-hidden />
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal>
                  <DropdownMenuPrimitive.Content
                    className="z-50 min-w-48 rounded-md border border-border bg-card p-1 text-foreground shadow-surface"
                    sideOffset={7}
                  >
                    {LIBRARY_LINKS.map((link) => (
                      <DropdownMenuPrimitive.Item asChild key={link.href}>
                        <Link
                          className="block rounded-sm px-3 py-2 text-sm hover:bg-primary/10 hover:text-primary"
                          href={link.href}
                        >
                          {link.label}
                        </Link>
                      </DropdownMenuPrimitive.Item>
                    ))}
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
              <NavLink href="/upload" label="上传" pathname={pathname} />
            </>
          )}
        </nav>
        
        {/* 移动端汉堡按钮 */}
        {!inAdmin ? (
          <button
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 hover:bg-muted/15"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="菜单"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        ) : null}
        
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
            <>
              <InboxLink unread={session.unread} variant="nav" />
              <Link
                className="inline-flex max-w-36 items-center gap-1 truncate rounded-md px-2.5 py-2 text-sm font-semibold hover:bg-muted/15"
                href="/me"
              >
                <UserRound size={17} aria-hidden />
                <span className="hidden sm:inline">{session.displayName}</span>
              </Link>
              {!inAdmin && hasPermissionKey(session.permissionKeys, "system.dashboard.read") ? (
                <Link
                  className="hidden rounded-md px-2.5 py-2 text-sm font-semibold hover:bg-muted/15 lg:inline-flex"
                  href="/admin"
                >
                  控制台
                </Link>
              ) : null}
              {inAdmin ? (
                <Link className="rounded-md px-2.5 py-2 text-sm font-semibold hover:bg-muted/15" href="/">
                  返回站点
                </Link>
              ) : null}
              {logout}
            </>
          ) : (
            <>
              {/* 移动端搜索按钮 - 放在登录注册按钮左边 */}
              {!inAdmin ? (
                <button
                  className="md:hidden inline-flex items-center justify-center rounded-md p-2 hover:bg-muted/15"
                  onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                  aria-label="搜索"
                  aria-expanded={mobileSearchOpen}
                >
                  <Search size={20} />
                </button>
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
          <div className="mx-auto flex w-[min(1180px,calc(100vw-2rem))] items-center gap-2 py-2">
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
            <button
              className="inline-flex items-center justify-center rounded-md p-2 hover:bg-muted/15"
              onClick={() => setMobileSearchOpen(false)}
              aria-label="关闭搜索"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      ) : null}
      
      {/* 移动端导航菜单 - 改为浮层 */}
      {!inAdmin && mobileMenuOpen ? (
        <nav className="fixed inset-x-0 top-14 z-50 border-b border-border bg-background shadow-lg md:hidden" aria-label="移动端导航">
          <div className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-2">
            <Link
              className={`block rounded-md px-3 py-2.5 text-sm font-semibold ${pathname === "/" ? "bg-primary text-primary-foreground" : "hover:bg-muted/15"}`}
              href="/"
              onClick={() => setMobileMenuOpen(false)}
            >
              首页
            </Link>
            <div className="my-1 border-t border-border/50" />
            <div className="text-xs font-semibold text-muted px-3 py-1.5">游戏库</div>
            {LIBRARY_LINKS.map((link) => (
              <Link
                key={link.href}
                className="block rounded-md px-3 py-2.5 pl-6 text-sm hover:bg-muted/15"
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="my-1 border-t border-border/50" />
            <Link
              className={`block rounded-md px-3 py-2.5 text-sm font-semibold ${pathname === "/upload" ? "bg-primary text-primary-foreground" : "hover:bg-muted/15"}`}
              href="/upload"
              onClick={() => setMobileMenuOpen(false)}
            >
              上传
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function NavLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-sm font-semibold ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted/15"}`}
      href={href}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}
