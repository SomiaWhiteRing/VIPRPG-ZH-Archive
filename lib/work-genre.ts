import { UiFeedbackError } from "@/lib/i18n/feedback";

export const WORK_GENRE_MAX_LENGTH = 100;

// Undefined means an older client omitted the field; null explicitly clears it.
export function normalizeWorkGenre(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new UiFeedbackError("upload.metadata.error.genreType");
  const genre = value.trim();
  if (genre.length > WORK_GENRE_MAX_LENGTH) {
    throw new UiFeedbackError("upload.metadata.error.genreLength", { max: WORK_GENRE_MAX_LENGTH });
  }
  if (/[\r\n]/u.test(genre)) throw new UiFeedbackError("upload.metadata.error.genreLine");
  return genre || null;
}
