import type { MessageKey } from "./i18n/core";

export type AccountNavigationItem = {
  href: string;
  label: MessageKey;
  group?: "account.group.organize" | "account.group.activity" | "account.group.settings";
  exact?: boolean;
  requiresUpload?: boolean;
  separatorBefore?: boolean;
};

export const ACCOUNT_NAVIGATION: readonly AccountNavigationItem[] = [
  { href: "/me", label: "account.nav.overview", exact: true },
  { href: "/me/messages", label: "account.nav.messages" },
  { href: "/me/favorites", label: "favorite.label", group: "account.group.organize", separatorBefore: true },
  { href: "/me/catalogs", label: "account.nav.catalogs", group: "account.group.organize" },
  { href: "/me/showcase", label: "account.nav.showcase", group: "account.group.organize" },
  { href: "/me/emojis", label: "account.nav.emojis", group: "account.group.organize" },
  { href: "/me/history", label: "account.nav.history", group: "account.group.activity", separatorBefore: true },
  { href: "/me/comments", label: "account.nav.comments", group: "account.group.activity" },
  { href: "/me/discussions", label: "account.nav.discussions", group: "account.group.activity" },
  { href: "/me/uploads", label: "account.nav.uploads", group: "account.group.activity", requiresUpload: true },
  { href: "/me/profile", label: "account.nav.profile", group: "account.group.settings", separatorBefore: true },
  { href: "/me/privacy", label: "account.nav.privacy", group: "account.group.settings" },
  { href: "/me/timeline", label: "core.nav.timeline", group: "account.group.settings" },
  { href: "/me/permissions", label: "account.nav.permissions", group: "account.group.settings" },
] as const;

export function isAccountNavigationActive(item: AccountNavigationItem, pathname: string) {
  return pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
}
