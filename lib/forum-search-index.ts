import { HttpError } from "./server/http/json";

export const FORUM_SEARCH_PAGE_SIZE = 20;
export const FORUM_SEARCH_QUERY_LENGTH = 64;

/** Position-preserving tokens; each Unicode code point occupies six hex digits. */
export function forumSearchTokens(value: string): string {
  const points = Array.from(value.normalize("NFKC").toLowerCase(), (point) =>
    point.codePointAt(0)!.toString(16).padStart(6, "0"),
  );
  const tokens = new Array<string>(Math.max(0, points.length - 1));
  for (let i = 0; i < tokens.length; i++) tokens[i] = `x${points[i]}${points[i + 1]}`;
  return tokens.join(" ");
}

export function forumSearchPhrase(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase().trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > FORUM_SEARCH_QUERY_LENGTH)
    throw new HttpError(400, "搜索词需要 2–64 个字符。", "forum_search_length");
  return `"${forumSearchTokens(normalized)}"`;
}
