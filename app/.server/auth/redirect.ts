import { parseUiLocale, UI_LOCALE_PARAM } from "@/lib/i18n/locale";

export function authReturnUrl(safePath: string, requestUrl: string): URL {
  const source = new URL(requestUrl);
  const target = new URL(safePath, source);
  const locale = parseUiLocale(source.searchParams.get(UI_LOCALE_PARAM));
  if (locale) target.searchParams.set(UI_LOCALE_PARAM, locale);
  return target;
}

export function sanitizeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/",
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  // Reject control characters before URL normalization can silently discard them.
  // eslint-disable-next-line no-control-regex
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }

  try {
    const resolved = new URL(value, "https://redirect.invalid");
    if (resolved.origin !== "https://redirect.invalid") return fallback;
  } catch {
    return fallback;
  }

  return value;
}
