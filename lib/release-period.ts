import { parseOriginalReleaseDate } from "@/lib/original-release-date";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";

/** Public library filters accept a year or month, never an individual day. */
export function normalizeReleasePeriod(value: string | undefined): string {
  const parsed = parseOriginalReleaseDate(value);
  return parsed && (parsed.precision === "year" || parsed.precision === "month")
    ? parsed.value ?? ""
    : "";
}

export function releasePeriodLabel(period: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  if (!period) return translate(locale, "release.allTime");
  const [year, month] = period.split("-");
  if (locale !== DEFAULT_UI_LOCALE) {
    return new Intl.DateTimeFormat(locale, { year: "numeric", ...(month && { month: "long" }), timeZone: "UTC" })
      .format(new Date(`${year}-${month ?? "01"}-01T00:00:00Z`));
  }
  return `${Number(year)}年${month ? `${Number(month)}月` : ""}`;
}
