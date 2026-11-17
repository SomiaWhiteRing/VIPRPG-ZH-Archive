import { translate, type MessageKey } from "@/lib/i18n/core";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import { HttpError, jsonError } from "@/lib/http";
import { preserveUiLocale, type UiLocale } from "@/lib/i18n/locale";

export function readRequiredFormString(
  formData: FormData,
  name: string,
  messageKey?: MessageKey,
): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim() === "") {
    if (messageKey) throw new UiFeedbackError(messageKey);
    throw new Error(`Missing ${name}`);
  }

  return value.trim();
}

export function readRequiredPassword(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new UiFeedbackError("auth.error.passwordRequired");
  }
  return value;
}

export function redirectWithParams(
  request: Request,
  path: string,
  params: Record<string, string | null | undefined>,
): Response {
  const source = new URL(request.url);
  const url = preserveUiLocale(new URL(path, source), source);

  applySearchParams(url, params);

  return redirectResponse(url);
}

export function redirectResponse(url: URL | string, status = 303): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url.toString(),
    },
  });
}

export function redirectBack(request: Request, fallbackPath: string): Response {
  const requestUrl = new URL(request.url);
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const refererUrl = new URL(referer);

      if (refererUrl.origin === requestUrl.origin) {
        return redirectResponse(preserveUiLocale(refererUrl, requestUrl));
      }
    } catch {
      // An invalid Referer falls through to the trusted fallback path.
    }
  }

  return redirectResponse(preserveUiLocale(new URL(fallbackPath, requestUrl), requestUrl));
}

export function formOrJsonError(
  request: Request,
  fallbackPath: string,
  message: string,
  error: unknown,
  locale: UiLocale,
): Response {
  if (requestWantsJson(request)) return jsonError(message, error);
  const fallback = translate(locale, "core.request.internal");
  return redirectWithParams(request, fallbackPath, {
    error: error instanceof HttpError || error instanceof UiFeedbackError
      ? formatFeedbackError(error, locale, fallback)
      : fallback,
  });
}

export function requestWantsJson(request: Request): boolean {
  return (
    request.headers.get("accept")?.toLowerCase().includes("application/json") ??
    false
  );
}

export function applySearchParams(
  url: URL,
  params: Record<string, string | null | undefined>,
): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}
