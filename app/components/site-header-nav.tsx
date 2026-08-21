"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InboxLink } from "@/app/components/ui/inbox-link";

type Session = {
  displayName: string;
  roleLabel: string;
  canAdmin: boolean;
  canSuper: boolean;
  unread: number;
};

type Props = {
  session: Session | null;
  logout: ReactNode;
  loginLink: ReactNode;
};

const PUBLIC_LINKS = [
  { href: "/games", label: "作品" },
  { href: "/creators", label: "作者" },
  { href: "/characters", label: "角色" },
  { href: "/tags", label: "标签" },
  { href: "/series", label: "系列" },
  { href: "/about", label: "关于" },
];

const ADMIN_LINKS = [
  { href: "/admin", label: "仪表盘" },
  { href: "/admin/works", label: "作品" },
  { href: "/admin/archive-versions", label: "归档" },
  { href: "/admin/creators", label: "作者" },
  { href: "/admin/characters", label: "角色" },
  { href: "/admin/tags", label: "标签" },
  { href: "/admin/series", label: "系列" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/maintenance", label: "维护" },
];

const ADMIN_SUPER_LINKS = [{ href: "/admin/audit", label: "审计" }];

export function SiteHeaderNav({ session, logout, loginLink }: Props) {
  const pathname = usePathname() ?? "/";
  const inAdmin = pathname.startsWith("/admin");

  const links = inAdmin
    ? [
        ...ADMIN_LINKS,
        ...(session?.canSuper ? ADMIN_SUPER_LINKS : []),
      ]
    : PUBLIC_LINKS;

  return (
    <header className={`site-header${inAdmin ? " admin" : ""}`}>
      <div className="site-header-inner">
        <Link className="site-brand" href={inAdmin ? "/admin" : "/"}>
          <span className="site-brand-mark">V</span>
          <span>{inAdmin ? "VIPRPG 控制台" : "VIPRPG 中文归档"}</span>
        </Link>
        <nav className="site-nav" aria-label={inAdmin ? "管理导航" : "站点导航"}>
          {!inAdmin ? (
            <Link
              href="/"
              className={pathname === "/" ? "active" : undefined}
              aria-current={pathname === "/" ? "page" : undefined}
            >
              首页
            </Link>
          ) : null}
          {links.map((link) => {
            const exact = pathname === link.href;
            const sectionActive =
              link.href !== "/" &&
              link.href !== "/admin" &&
              pathname.startsWith(`${link.href}/`);
            const active = exact || sectionActive;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "active" : undefined}
                aria-current={exact ? "page" : sectionActive ? "location" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
          {!inAdmin ? (
            <Link
              href="/upload"
              className={pathname.startsWith("/upload") ? "active" : undefined}
              aria-current={
                pathname === "/upload"
                  ? "page"
                  : pathname.startsWith("/upload/")
                    ? "location"
                    : undefined
              }
            >
              上传
            </Link>
          ) : null}
        </nav>
        <div className="site-session">
          {session ? (
            <>
              <InboxLink unread={session.unread} variant="nav" />
              <Link className="button" href="/me">
                <span aria-hidden>👤</span>
                {session.displayName}
              </Link>
              {session.canAdmin && !inAdmin ? (
                <Link className="button primary" href="/admin">
                  控制台
                </Link>
              ) : null}
              {inAdmin ? (
                <Link className="button" href="/">
                  返回站点
                </Link>
              ) : null}
              <span
                className="session-pill"
                title={`当前层级：${session.roleLabel}`}
              >
                {session.roleLabel}
              </span>
              {logout}
            </>
          ) : (
            <>
              <Link className="button" href="/register">
                注册
              </Link>
              {loginLink}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
