import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { UiFeedbackError } from "@/lib/i18n/feedback";

export type WorkMoreInfo = { title: string; body: string };

export const MORE_INFO_MAX_ITEMS = 20;
export const MORE_INFO_TITLE_MAX_LENGTH = 100;
export const MORE_INFO_BODY_MAX_LENGTH = 10_000;

export function moreInfoItemError(item: WorkMoreInfo, locale: UiLocale = DEFAULT_UI_LOCALE): {
  field: keyof WorkMoreInfo;
  message: string;
  reason: "titleRequired" | "bodyRequired" | "titleMax" | "bodyMax";
} | null {
  const title = item.title.trim();
  const body = item.body.trim();
  if (!title && !body) return null;
  if (!title) return { field: "title", reason: "titleRequired", message: translate(locale, "upload.info.titleRequired") };
  if (!body) return { field: "body", reason: "bodyRequired", message: translate(locale, "upload.info.bodyRequired") };
  if (title.length > MORE_INFO_TITLE_MAX_LENGTH) {
    return { field: "title", reason: "titleMax", message: translate(locale, "upload.info.titleMax", { limit: MORE_INFO_TITLE_MAX_LENGTH }) };
  }
  if (body.length > MORE_INFO_BODY_MAX_LENGTH) {
    return { field: "body", reason: "bodyMax", message: translate(locale, "upload.info.bodyMax", { limit: MORE_INFO_BODY_MAX_LENGTH }) };
  }
  return null;
}

// The field is optional; when present it is always a complete, ordered list.
export function normalizeWorkMoreInfo(value: unknown): WorkMoreInfo[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new UiFeedbackError("upload.info.error.list");
  if (value.length > MORE_INFO_MAX_ITEMS) throw new UiFeedbackError("upload.info.error.limit", { max: MORE_INFO_MAX_ITEMS });
  const items: WorkMoreInfo[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.title !== "string" || typeof item.body !== "string") {
      throw new UiFeedbackError("upload.info.error.itemFormat", { index: index + 1 });
    }
    const normalized = { title: item.title.trim(), body: item.body.trim() };
    const error = moreInfoItemError(normalized);
    if (error) throw new UiFeedbackError("upload.info.error.item", {
      index: index + 1,
      reason: error.reason,
      limit: error.field === "title" ? MORE_INFO_TITLE_MAX_LENGTH : MORE_INFO_BODY_MAX_LENGTH,
    });
    if (normalized.title || normalized.body) items.push(normalized);
  }
  return items;
}
