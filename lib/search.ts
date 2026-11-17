import { translate, type MessageKey } from "./i18n/core";
import type { UiLocale } from "./i18n/locale";

export const SEARCH_SCOPES = [
  ["works", "作品"],
  ["discussions", "讨论版"],
  ["creators", "作者"],
  ["characters", "角色"],
  ["tags", "标签"],
  ["catalogs", "目录"],
] as const;

type SearchScope = (typeof SEARCH_SCOPES)[number][0];
const searchScopeKeys = {
  works: "search.scopes.works",
  discussions: "core.nav.discussions",
  creators: "search.scopes.creators",
  characters: "core.nav.characters",
  tags: "search.scopes.tags",
  catalogs: "core.nav.catalogs",
} satisfies Record<SearchScope, MessageKey>;

export function searchScopeLabel(scope: SearchScope, locale: UiLocale) {
  return translate(locale, searchScopeKeys[scope]);
}

export function getSearchScope(value: string | null | undefined) {
  return SEARCH_SCOPES.find(([scope]) => scope === value) ?? SEARCH_SCOPES[0];
}

export function getPageSearchScope(pathname: string, search: string) {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  if (segments[0] === "search" && segments.length === 1) {
    return getSearchScope(new URLSearchParams(search).get("scope"));
  }
  const section =
    segments[0] === "me"
      ? segments[1]
      : segments[0] === "users"
        ? segments[2]
        : segments[0];
  return getSearchScope(section);
}
