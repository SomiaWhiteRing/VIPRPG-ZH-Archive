import { HttpError } from "@/lib/http";
import { normalizeWorkMoreInfo } from "@/lib/work-more-info";

export function parseWorkMoreInfo(value: unknown) {
  try {
    return normalizeWorkMoreInfo(value);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "更多信息格式不合法。",
    );
  }
}

export function parseWorkMoreInfoJson(value: FormDataEntryValue | null) {
  if (value === null) return [];
  if (typeof value !== "string")
    throw new HttpError(400, "更多信息格式不合法。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "更多信息无法读取。");
  }
  return parseWorkMoreInfo(parsed);
}
