export type AccountNavigationItem = {
  href: string;
  label: string;
  exact?: boolean;
  requiresUpload?: boolean;
};

export const ACCOUNT_NAVIGATION: readonly AccountNavigationItem[] = [
  { href: "/me", label: "概览", exact: true },
  { href: "/me/profile", label: "个人资料" },
  { href: "/me/privacy", label: "隐私" },
  { href: "/me/favorites", label: "收藏" },
  { href: "/me/catalogs", label: "我的目录" },
  { href: "/me/history", label: "游玩历史" },
  { href: "/me/comments", label: "我的评论" },
  { href: "/me/uploads", label: "我的上传", requiresUpload: true },
] as const;
