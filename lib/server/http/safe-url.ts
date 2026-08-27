import { HttpError } from "@/lib/server/http/json";

/** External links are rendered as anchors, so only web URLs are accepted. */
export function normalizeHttpUrl(value: string | null | undefined, field = "URL"): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, `${field} 格式不合法`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${field} 只允许使用 http 或 https`);
  }
  return trimmed;
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
