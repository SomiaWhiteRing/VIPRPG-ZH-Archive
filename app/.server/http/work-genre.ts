import { HttpError } from "@/lib/http";
import { UiFeedbackError } from "@/lib/i18n/feedback";
import { normalizeWorkGenre } from "@/lib/work-genre";

export function parseWorkGenre(value: unknown) {
  try {
    return normalizeWorkGenre(value);
  } catch (error) {
    if (error instanceof UiFeedbackError)
      throw new HttpError(400, error.message, undefined, error.messageKey, error.values);
    throw new HttpError(400, error instanceof Error ? error.message : "类型不合法。");
  }
}
