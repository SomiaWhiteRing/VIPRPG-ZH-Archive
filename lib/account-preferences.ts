import { ACCOUNT_NAVIGATION } from "./account-navigation";
import { UiFeedbackError } from "./i18n/feedback";
import { parseUiLocale, type UiLanguagePreference } from "./i18n/locale";

export const ACCOUNT_SHORTCUTS = ACCOUNT_NAVIGATION.filter(
  (item) => item.href !== "/me" && item.href !== "/me/permissions",
);
export const DEFAULT_ACCOUNT_SHORTCUTS = ["/me/messages", "/me/favorites", "/me/emojis"];

export type ColorTheme = "light" | "dark" | "system";
export const DEFAULT_COLOR_THEME: ColorTheme = "system";

export const COLOR_THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;

export function parseColorTheme(value: unknown): ColorTheme {
  if (value !== "light" && value !== "dark" && value !== "system") {
    throw new UiFeedbackError("account.theme.invalid");
  }
  return value;
}

export type AccountPreferences = {
  uiLanguage: UiLanguagePreference;
  colorTheme: ColorTheme;
  timelineAsHomepage: boolean;
  notifyUploadedWorkComments: boolean;
  notifyFriendAdditions: boolean;
  receivePrivateMessages: boolean;
  includePlayerInZip: boolean;
  showGameCardInteractionData: boolean;
  hideDeletedContent: boolean;
  shortcuts: string[];
};

export function parseUiLanguagePreference(value: unknown): UiLanguagePreference {
  if (value === "auto") return value;
  const locale = typeof value === "string" ? parseUiLocale(value) : null;
  if (!locale) throw new UiFeedbackError("account.language.invalid");
  return locale;
}

export function parseAccountShortcuts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > ACCOUNT_SHORTCUTS.length
    || value.some((href) => typeof href !== "string" || !ACCOUNT_SHORTCUTS.some((item) => item.href === href))
    || new Set(value).size !== value.length) {
    throw new UiFeedbackError("account.shortcuts.invalid");
  }
  return value;
}

export function readAccountPreferences(includePlayer: number, shortcuts: string | null, notifyUploadedWorkComments: number, showGameCardInteractionData: number, hideDeletedContent: number, colorTheme: string, timelineAsHomepage: number, notifyFriendAdditions: number, receivePrivateMessages: number, uiLanguage = "auto"): AccountPreferences {
  return {
    uiLanguage: parseUiLanguagePreference(uiLanguage),
    colorTheme: parseColorTheme(colorTheme),
    timelineAsHomepage: timelineAsHomepage === 1,
    notifyUploadedWorkComments: notifyUploadedWorkComments !== 0,
    notifyFriendAdditions: notifyFriendAdditions === 1,
    receivePrivateMessages: receivePrivateMessages === 1,
    includePlayerInZip: includePlayer !== 0,
    showGameCardInteractionData: showGameCardInteractionData !== 0,
    hideDeletedContent: hideDeletedContent === 1,
    shortcuts: shortcuts === null ? [...DEFAULT_ACCOUNT_SHORTCUTS] : parseAccountShortcuts(JSON.parse(shortcuts)),
  };
}
