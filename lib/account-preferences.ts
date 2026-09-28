import { ACCOUNT_NAVIGATION } from "./account-navigation";

export const ACCOUNT_SHORTCUTS = ACCOUNT_NAVIGATION.filter(
  (item) => item.href !== "/me" && item.href !== "/me/permissions",
);
export const DEFAULT_ACCOUNT_SHORTCUTS = ["/me/favorites", "/me/emojis", "/me/catalogs"];

export type AccountPreferences = {
  includePlayerInZip: boolean;
  shortcuts: string[];
};

export function parseAccountShortcuts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > ACCOUNT_SHORTCUTS.length
    || value.some((href) => typeof href !== "string" || !ACCOUNT_SHORTCUTS.some((item) => item.href === href))
    || new Set(value).size !== value.length) {
    throw new Error("快捷入口列表无效，请刷新后重试。");
  }
  return value;
}

export function readAccountPreferences(includePlayer: number, shortcuts: string | null): AccountPreferences {
  return {
    includePlayerInZip: includePlayer !== 0,
    shortcuts: shortcuts === null ? [...DEFAULT_ACCOUNT_SHORTCUTS] : parseAccountShortcuts(JSON.parse(shortcuts)),
  };
}
