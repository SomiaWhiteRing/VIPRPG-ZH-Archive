import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";

export type TagSource = "all" | "public" | "user";
export type UserTagSummary = { name: string; workCount: number };
export type CombinedTagSummary = { name: string; usageCount: number };
export type WorkTagSummary = CombinedTagSummary & { source: "public" | "user" };
export type FavoriteDetails = { tags: string[]; note: string };
export type WorkFavoriteUpdate = { favorited: boolean; favoriteCount?: number; tags?: WorkTagSummary[] };
export type WorkFavorite = {
  favorited: boolean;
  tags: string[];
  note: string;
  workTags: string[];
  frequentTags: UserTagSummary[];
};

export const MAX_PUBLIC_TAGS = 10;
export const NON_VIPRPG_TAG = "非VIPRPG";
export const MAX_USER_TAGS = 10;
export const MAX_USER_TAG_LENGTH = 20;
export const MAX_FAVORITE_NOTE_LENGTH = 500;

export function parseFavoriteNote(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "收藏吐槽必须是文本。");
  const note = value.replace(/\r\n?/g, "\n").trim();
  if ([...note].length > MAX_FAVORITE_NOTE_LENGTH) throw new HttpError(400, `收藏吐槽最多 ${MAX_FAVORITE_NOTE_LENGTH} 字。`);
  if (note.includes("\0")) throw new HttpError(400, "收藏吐槽不能包含空字符。");
  return note;
}

export function getTagSource(value: unknown): TagSource {
  return value === "public" || value === "user" ? value : "all";
}

export function tagHref(name: string, source: TagSource = "all"): string {
  return `/tags?${new URLSearchParams({ tag: name, ...(source !== "all" ? { tag_source: source } : {}) })}`;
}

// Match SQLite NOCASE while preserving the submitted display spelling.
export function tagNameKey(value: string): string {
  return normalizeEntityName(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function validateUserTag(value: string): string | null {
  const name = normalizeEntityName(value);
  if (!name) return "标签名称不能为空。";
  if ([...name].length > MAX_USER_TAG_LENGTH) return `每个标签最多 ${MAX_USER_TAG_LENGTH} 字。`;
  if ([...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "标签不能包含控制字符。";
  return null;
}

export function parseUserTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_USER_TAGS || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `标签必须是最多 ${MAX_USER_TAGS} 项的文字列表。`);
  }
  const tags = new Map<string, string>();
  for (const item of value as string[]) {
    const error = validateUserTag(item);
    if (error) throw new HttpError(400, error);
    const name = normalizeEntityName(item);
    if (!tags.has(tagNameKey(name))) tags.set(tagNameKey(name), name);
  }
  return [...tags.values()];
}
