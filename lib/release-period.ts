import { parseOriginalReleaseDate } from "@/lib/original-release-date";

/** Public library filters accept a year or month, never an individual day. */
export function normalizeReleasePeriod(value: string | undefined): string {
  const parsed = parseOriginalReleaseDate(value);
  return parsed && (parsed.precision === "year" || parsed.precision === "month")
    ? parsed.value ?? ""
    : "";
}

export function releasePeriodLabel(period: string): string {
  if (!period) return "全部时间";
  const [year, month] = period.split("-");
  return `${Number(year)}年${month ? `${Number(month)}月` : ""}`;
}
