export type AccountNavigationItem = {
  href: string;
  label: string;
  group?: "收藏与整理" | "活动与创作" | "账户设置";
  exact?: boolean;
  requiresUpload?: boolean;
  separatorBefore?: boolean;
};

export const ACCOUNT_NAVIGATION: readonly AccountNavigationItem[] = [
  { href: "/me", label: "概览", exact: true },
  { href: "/me/favorites", label: "收藏", group: "收藏与整理", separatorBefore: true },
  { href: "/me/catalogs", label: "我的目录", group: "收藏与整理" },
  { href: "/me/showcase", label: "喜爱展柜", group: "收藏与整理" },
  { href: "/me/emojis", label: "表情库", group: "收藏与整理" },
  { href: "/me/history", label: "游玩历史", group: "活动与创作", separatorBefore: true },
  { href: "/me/comments", label: "我的评论", group: "活动与创作" },
  { href: "/me/discussions", label: "我的讨论", group: "活动与创作" },
  { href: "/me/uploads", label: "我的上传", group: "活动与创作", requiresUpload: true },
  { href: "/me/profile", label: "个人资料", group: "账户设置", separatorBefore: true },
  { href: "/me/privacy", label: "隐私与偏好", group: "账户设置" },
  { href: "/me/timeline", label: "时间线", group: "账户设置" },
  { href: "/me/permissions", label: "权限申请", group: "账户设置" },
] as const;

export function isAccountNavigationActive(item: AccountNavigationItem, pathname: string) {
  return pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
}
