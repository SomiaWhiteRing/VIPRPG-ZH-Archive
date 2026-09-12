export type WorkMoreInfo = { title: string; body: string };

export const MORE_INFO_MAX_ITEMS = 20;
export const MORE_INFO_TITLE_MAX_LENGTH = 100;
export const MORE_INFO_BODY_MAX_LENGTH = 10_000;

export function moreInfoItemError(item: WorkMoreInfo): {
  field: keyof WorkMoreInfo;
  message: string;
} | null {
  const title = item.title.trim();
  const body = item.body.trim();
  if (!title && !body) return null;
  if (!title) return { field: "title", message: "请填写标题，或移除此条信息。" };
  if (!body) return { field: "body", message: "请填写内容，或移除此条信息。" };
  if (title.length > MORE_INFO_TITLE_MAX_LENGTH) {
    return { field: "title", message: `标题最多 ${MORE_INFO_TITLE_MAX_LENGTH} 字。` };
  }
  if (body.length > MORE_INFO_BODY_MAX_LENGTH) {
    return { field: "body", message: `内容最多 ${MORE_INFO_BODY_MAX_LENGTH.toLocaleString("en-US")} 字。` };
  }
  return null;
}

// The field is optional; when present it is always a complete, ordered list.
export function normalizeWorkMoreInfo(value: unknown): WorkMoreInfo[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("更多信息必须为列表。");
  if (value.length > MORE_INFO_MAX_ITEMS) throw new Error(`更多信息最多 ${MORE_INFO_MAX_ITEMS} 条。`);
  const items: WorkMoreInfo[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.title !== "string" || typeof item.body !== "string") {
      throw new Error(`第 ${index + 1} 条更多信息格式不合法。`);
    }
    const normalized = { title: item.title.trim(), body: item.body.trim() };
    const error = moreInfoItemError(normalized);
    if (error) throw new Error(`第 ${index + 1} 条信息：${error.message}`);
    if (normalized.title || normalized.body) items.push(normalized);
  }
  return items;
}
