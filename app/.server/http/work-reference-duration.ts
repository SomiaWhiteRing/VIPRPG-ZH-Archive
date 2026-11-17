import { HttpError } from "@/lib/http";
import { UiFeedbackError } from "@/lib/i18n/feedback";
import { normalizeWorkReferenceDuration } from "@/lib/work-reference-duration";

export function parseWorkReferenceDuration(value: unknown) {
  try {
    return normalizeWorkReferenceDuration(value);
  } catch (error) {
    if (error instanceof UiFeedbackError)
      throw new HttpError(400, error.message, undefined, error.messageKey, error.values);
    throw new HttpError(400, error instanceof Error ? error.message : "参考时长不合法。");
  }
}
