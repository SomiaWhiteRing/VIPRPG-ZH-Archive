import type { ParsedComponents } from "chrono-node";
import { parseOriginalReleaseDate } from "./original-release-date";

export async function parsePastedReleaseDates(text: string): Promise<string[]> {
  const date = text
    .normalize("NFKC")
    .trim()
    .replace(/[〇零一二三四五六七八九]{4}(?=\s*年)/g, (year) =>
      [...year]
        .map((digit) => digit === "〇" ? 0 : "零一二三四五六七八九".indexOf(digit))
        .join(""),
    );
  if (!date || date.length > 4096) return [];

  // Preserve partial precision and compact numeric dates before natural-language parsing.
  const parts =
    /^(\d{4})(?:(\d{2})(\d{2})?)?$/.exec(date)?.slice(1) ??
    /^(\d{4})\s*年(?:\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*[日号])?)?$/.exec(date)?.slice(1) ??
    /^(\d{4})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{1,2}))?$/.exec(date)?.slice(1);
  if (parts) {
    const value = validatedDate(
      parts.filter((part) => part !== undefined).map(Number),
    );
    return value ? [value] : [];
  }
  if (/^\d{10}(?:\d{3})?$/.test(date)) {
    const timestamp = new Date(Number(date) * (date.length === 10 ? 1000 : 1));
    const value = validatedDate([
      timestamp.getFullYear(),
      timestamp.getMonth() + 1,
      timestamp.getDate(),
    ]);
    return value ? [value] : [];
  }

  const [en, ja, zh] = await Promise.all([
    import("chrono-node/en"),
    import("chrono-node/ja"),
    import("chrono-node/zh"),
  ]);
  const reference = new Date();
  const results = [en.casual, en.GB, ja.casual, zh.hans.casual, zh.hant.casual].flatMap(
    (parser) => parser.parse(date, reference),
  );
  // Prefer a complete expression over a nested match, such as a Japanese era date
  // over the bare era year that a Chinese parser may also recognize.
  const complete = results.filter((result) => !results.some((other) =>
    other.text.length > result.text.length &&
    other.index <= result.index &&
    other.index + other.text.length >= result.index + result.text.length,
  ));
  const values = complete.flatMap((result) =>
    [result.start, result.end].flatMap((components) => {
      const value = components ? dateFromComponents(components) : null;
      return value ? [value] : [];
    }),
  );
  return [...new Set(values)];
}

function dateFromComponents(components: ParsedComponents): string | null {
  // A copied release date must not silently acquire an assumed year or day.
  // Relative expressions such as “昨天” resolve these parts explicitly in Chrono.
  if (!components.isCertain("year")) return null;
  const parts = [components.get("year")!];
  if (components.isCertain("month")) {
    parts.push(components.get("month")!);
    if (components.isCertain("day")) parts.push(components.get("day")!);
  }
  return validatedDate(parts);
}

function validatedDate(parts: number[]): string | null {
  const value = parts
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
  return parseOriginalReleaseDate(value)?.value ?? null;
}
