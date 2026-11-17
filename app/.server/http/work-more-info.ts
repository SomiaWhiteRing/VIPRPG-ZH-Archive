import { HttpError } from "@/lib/http";
import { UiFeedbackError } from "@/lib/i18n/feedback";
import { normalizeWorkMoreInfo } from "@/lib/work-more-info";

export function parseWorkMoreInfo(value: unknown) {
  try {
    return normalizeWorkMoreInfo(value);
  } catch (error) {
    if (error instanceof UiFeedbackError)
      throw new HttpError(400, error.message, undefined, error.messageKey, error.values);
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "更多信息格式不合法。",
    );
  }
}

export function parseWorkMoreInfoJson(value: FormDataEntryValue | null) {
  if (value === null) return [];
  if (typeof value !== "string")
    throw new HttpError(400, "更多信息格式不合法。", undefined, "upload.info.error.format");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "更多信息无法读取。", undefined, "upload.info.error.unreadable");
  }
  return parseWorkMoreInfo(parsed);
}
