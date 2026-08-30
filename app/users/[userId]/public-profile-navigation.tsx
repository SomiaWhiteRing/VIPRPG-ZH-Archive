"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";

export function PublicProfileNavigation({ userId }: { userId: number }) {
  const pathname = usePathname() ?? "";
  const base = `/users/${userId}`;
  const links = [
    { href: base, label: "概览", exact: true },
    { href: `${base}/favorites`, label: "收藏" },
    { href: `${base}/history`, label: "最近游玩" },
    { href: `${base}/catalogs`, label: "目录" },
    { href: `${base}/comments`, label: "评论" },
  ];
  return <nav aria-label="用户公开资料导航" className="flex gap-1 overflow-x-auto border-b border-border py-2">{links.map((item) => { const active = item.exact ? pathname === item.href : pathname.startsWith(item.href); return <Link aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold", active ? "bg-primary text-primary-foreground" : "hover:bg-muted/15")} href={item.href} key={item.href}>{item.label}</Link>; })}</nav>;
}
