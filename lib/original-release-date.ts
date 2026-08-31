export type OriginalReleasePrecision = "year" | "month" | "day" | "unknown";

export const ORIGINAL_RELEASE_DATE_FORMAT_ERROR =
  "发布日期格式应为 YYYY、YYYY-MM 或 YYYY-MM-DD。";

export function parseOriginalReleaseDate(value: string | null | undefined): {
  value: string | null;
  precision: OriginalReleasePrecision;
} | null {
  const date = value?.trim() ?? "";
  if (!date) return { value: null, precision: "unknown" };
  if (/^\d{4}$/.test(date)) return { value: date, precision: "year" };

  const month = /^(\d{4})-(\d{2})$/.exec(date);
  if (month) {
    const monthNumber = Number(month[2]);
    return monthNumber >= 1 && monthNumber <= 12
      ? { value: date, precision: "month" }
      : null;
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!day) return null;
  const yearNumber = Number(day[1]);
  const monthNumber = Number(day[2]);
  const dayNumber = Number(day[3]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const daysInMonth = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
  return dayNumber >= 1 && dayNumber <= daysInMonth
    ? { value: date, precision: "day" }
    : null;
}
