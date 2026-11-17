import { HttpError } from "@/lib/http";
import { ApiResponseError } from "@/lib/ui/api-response";
import { translate, type MessageKey } from "./core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "./locale";

export class UiFeedbackError extends Error {
  constructor(readonly messageKey: MessageKey, readonly values?: Record<string, string | number>, options?: ErrorOptions) {
    super(translate(DEFAULT_UI_LOCALE, messageKey, values), options);
  }
}

export class UiHttpError extends HttpError {
  constructor(status: number, messageKey: MessageKey, code?: string) {
    super(status, translate(DEFAULT_UI_LOCALE, messageKey), code, messageKey);
  }
}

export class UiFeedbackDOMException extends DOMException {
  constructor(name: string, readonly messageKey: MessageKey) {
    super(translate(DEFAULT_UI_LOCALE, messageKey), name);
  }
}

export function formatFeedbackError(error: unknown, locale: UiLocale, fallback: string) {
  if (error instanceof UiFeedbackError) return translate(locale, error.messageKey, error.values);
  if (error instanceof UiFeedbackDOMException) return translate(locale, error.messageKey);
  if (error instanceof HttpError && error.messageKey) return translate(locale, error.messageKey, error.messageValues);
  if (error instanceof ApiResponseError) return error.messageFor(locale);
  return error instanceof Error ? error.message : fallback;
}
