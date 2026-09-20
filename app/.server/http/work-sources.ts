import { normalizeHttpUrl } from "@/app/.server/http/safe-url";
import { HttpError } from "@/lib/http";
import type { WorkSourceLink } from "@/lib/work-sources";

export function parseWorkSources(value: unknown): WorkSourceLink[] {
  if (!Array.isArray(value)) throw new HttpError(400, "作品来源必须是完整列表");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item.label !== "string" || typeof item.url !== "string")
      throw new HttpError(400, "作品来源格式不合法");
    const url = normalizeHttpUrl(item.url, "作品来源");
    if (!url) throw new HttpError(400, "作品来源网址不能为空");
    return { label: item.label.trim() || "来源链接", url };
  }).filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export function parseWorkSourcesJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string") throw new HttpError(400, "请提交完整的作品来源列表");
  try { return parseWorkSources(JSON.parse(value)); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "作品来源列表不是有效 JSON");
  }
}
