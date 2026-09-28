export const WORK_GENRE_MAX_LENGTH = 100;

// Undefined means an older client omitted the field; null explicitly clears it.
export function normalizeWorkGenre(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("类型必须为文本。");
  const genre = value.trim();
  if (genre.length > WORK_GENRE_MAX_LENGTH) {
    throw new Error(`类型最多 ${WORK_GENRE_MAX_LENGTH} 字。`);
  }
  if (/[\r\n]/u.test(genre)) throw new Error("类型请填写为单行文本。");
  return genre || null;
}
