export const SEARCH_SCOPES = [
  ["works", "作品"],
  ["discussions", "讨论版"],
  ["creators", "作者"],
  ["characters", "角色"],
  ["tags", "标签"],
  ["catalogs", "目录"],
] as const;

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
