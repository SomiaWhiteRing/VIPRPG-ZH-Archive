import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";

export type CreatorLink = { label: string; url: string };

export const CREATOR_LINK_PRESETS = ["itch", "Twitter(X)", "blog", "个人网站"] as const;
export const CREATOR_LINK_LIMITS = { label: 120, url: 2048 } as const;

export function parseCreatorLinks(value: string): CreatorLink[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "网站格式不正确");
  }
  return normalizeCreatorLinks(parsed);
}

export function normalizeCreatorLinks(value: unknown): CreatorLink[] {
  if (!Array.isArray(value)) throw new HttpError(400, "网站格式不正确");
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("label" in item) || !("url" in item) || typeof item.label !== "string" || typeof item.url !== "string") {
      throw new HttpError(400, "网站格式不正确");
    }
    const label = normalizeEntityName(item.label);
    const url = item.url.trim();
    if (!label && !url) return [];
    if (!label || !url) throw new HttpError(400, "请补全网站名称和网址，或移除该行");
    if (label.length > CREATOR_LINK_LIMITS.label || url.length > CREATOR_LINK_LIMITS.url) throw new HttpError(400, "网站名称或网址过长");
    let protocol: string;
    try { protocol = new URL(url).protocol; } catch { throw new HttpError(400, "网站网址格式不正确"); }
    if (protocol !== "http:" && protocol !== "https:") throw new HttpError(400, "网站网址只支持 http 或 https");
    return [{ label, url }];
  });
}
