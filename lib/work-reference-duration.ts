import { UiFeedbackError } from "@/lib/i18n/feedback";
import { translate, type MessageKey } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";

export const WORK_REFERENCE_DURATIONS = [
  "nnkr（~5min）",
  "短篇（~30min）",
  "中篇（~2h）",
  "长篇（~10h）",
  "巨作（10h+）",
] as const;

export const WORK_REFERENCE_DURATION_MAX_LENGTH = 100;

const REFERENCE_DURATION_KEYS = {
  "nnkr（~5min）": "library.duration.tiny",
  "短篇（~30min）": "library.duration.short",
  "中篇（~2h）": "library.duration.medium",
  "长篇（~10h）": "library.duration.long",
  "巨作（10h+）": "library.duration.epic",
} as const satisfies Record<(typeof WORK_REFERENCE_DURATIONS)[number], MessageKey>;

export function referenceDurationLabel(value: string, locale: UiLocale): string {
  return Object.hasOwn(REFERENCE_DURATION_KEYS, value)
    ? translate(locale, REFERENCE_DURATION_KEYS[value as keyof typeof REFERENCE_DURATION_KEYS])
    : value;
}

export function normalizeWorkReferenceDuration(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new UiFeedbackError("upload.metadata.error.durationType");
  const duration = value.trim();
  if (duration.length > WORK_REFERENCE_DURATION_MAX_LENGTH) {
    throw new UiFeedbackError("upload.metadata.error.durationLength", { max: WORK_REFERENCE_DURATION_MAX_LENGTH });
  }
  if (/[\r\n]/u.test(duration)) throw new UiFeedbackError("upload.metadata.error.durationLine");
  return duration || null;
}
