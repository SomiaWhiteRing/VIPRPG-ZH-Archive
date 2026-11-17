export const UI_LOCALES = {
  "zh-Hans": "简体中文",
  ja: "日本語",
  en: "English",
} as const;

export type UiLocale = keyof typeof UI_LOCALES;
export const DEFAULT_UI_LOCALE: UiLocale = "zh-Hans";
export const UI_LOCALE_PARAM = "lang";
export const RAKUEN_LOCALE_MESSAGE = "viprpg:rakuen-locale";

export function parseUiLocale(value: string | null): UiLocale | null {
  return value && Object.hasOwn(UI_LOCALES, value) ? value as UiLocale : null;
}

export type UiLanguagePreference = "auto" | UiLocale;

export function browserUiLocale(acceptLanguage: string | null): UiLocale {
  const languages = (acceptLanguage ?? "").split(",").map((entry) => {
    const [language, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find(value => value.trim().startsWith("q="));
    return { language, quality: quality ? Number(quality.trim().slice(2)) : 1 };
  }).filter(entry => Number.isFinite(entry.quality) && entry.quality > 0 && entry.quality <= 1)
    .sort((left, right) => right.quality - left.quality);
  for (const { language } of languages) {
    if (/^zh(?:-|$)/.test(language)) return "zh-Hans";
    if (/^ja(?:-|$)/.test(language)) return "ja";
    if (/^en(?:-|$)/.test(language)) return "en";
  }
  return DEFAULT_UI_LOCALE;
}

export function requestUiLocale(request: Request, preference: UiLanguagePreference = "auto"): UiLocale {
  return parseUiLocale(new URL(request.url).searchParams.get(UI_LOCALE_PARAM))
    ?? (preference === "auto" ? browserUiLocale(request.headers.get("Accept-Language")) : preference);
}

export function withoutUiLocale(search: string) {
  const params = new URLSearchParams(search);
  params.delete(UI_LOCALE_PARAM);
  return params;
}

export function preserveUiLocale(destination: URL, source: URL): URL {
  const locale = parseUiLocale(source.searchParams.get(UI_LOCALE_PARAM));
  if (locale && destination.origin === source.origin && !destination.searchParams.has(UI_LOCALE_PARAM)) {
    destination.searchParams.set(UI_LOCALE_PARAM, locale);
  }
  return destination;
}

export function preserveFormRedirectLocale(destination: URL, submittedFrom: URL, current: URL, locale: UiLocale | null): void {
  if (destination.origin !== current.origin) return;
  const currentLocale = parseUiLocale(current.searchParams.get(UI_LOCALE_PARAM));
  if (currentLocale && currentLocale !== parseUiLocale(submittedFrom.searchParams.get(UI_LOCALE_PARAM))) {
    destination.searchParams.set(UI_LOCALE_PARAM, currentLocale);
  } else if (locale && !destination.searchParams.has(UI_LOCALE_PARAM)) {
    destination.searchParams.set(UI_LOCALE_PARAM, locale);
  }
}
