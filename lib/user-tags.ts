import { normalizeEntityName } from "@/lib/entity-name";
import { UiHttpError } from "@/lib/i18n/feedback";

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
  if (typeof value !== "string") throw new UiHttpError(400, "favorite.error.noteType");
  const note = value.replace(/\r\n?/g, "\n").trim();
  if ([...note].length > MAX_FAVORITE_NOTE_LENGTH) throw new UiHttpError(400, "favorite.error.noteLength");
  if (note.includes("\0")) throw new UiHttpError(400, "favorite.error.noteNull");
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

export function validateUserTag(value: string) {
  const name = normalizeEntityName(value);
  if (!name) return "favorite.error.tagEmpty";
  if ([...name].length > MAX_USER_TAG_LENGTH) return "favorite.error.tagLength";
  if ([...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "favorite.error.tagControl";
  return null;
}

export function parseUserTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new UiHttpError(400, "favorite.error.tagList");
  }
  const submittedTags = (value as string[]).filter((item) => tagNameKey(item) !== "viprpg");
  if (submittedTags.length > MAX_USER_TAGS) {
    throw new UiHttpError(400, "favorite.error.tagList");
  }
  const tags = new Map<string, string>();
  for (const item of submittedTags) {
    const error = validateUserTag(item);
    if (error) throw new UiHttpError(400, error);
    const name = normalizeEntityName(item);
    if (!tags.has(tagNameKey(name))) tags.set(tagNameKey(name), name);
  }
  return [...tags.values()];
}
