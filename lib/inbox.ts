export const INBOX_PAGE_SIZE = 30;
export const INBOX_CATEGORIES = ["all", "replies", "likes", "system", "pending"] as const;
export type InboxCategory = typeof INBOX_CATEGORIES[number];
export type InboxCursor = { itemId: number; direction: "older" | "newer" };

export function inboxCategory(value: unknown): InboxCategory {
  return INBOX_CATEGORIES.find((category) => category === value) ?? "all";
}

export function inboxCursor(
  before: unknown,
  after: unknown,
): InboxCursor | undefined {
  const value = before ?? after;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const itemId = Number(value);
  if (!Number.isSafeInteger(itemId)) return undefined;
  return { itemId, direction: before != null ? "older" : "newer" };
}

export function inboxHref(
  category: InboxCategory,
  unread: boolean,
  page = 1,
  cursor?: InboxCursor,
) {
  const query = new URLSearchParams();
  if (category !== "all") query.set("category", category);
  if (unread) query.set("unread", "1");
  if (unread && cursor)
    query.set(
      cursor.direction === "older" ? "before" : "after",
      String(cursor.itemId),
    );
  if (!unread && page > 1) query.set("page", String(page));
  return `/inbox${query.size ? `?${query}` : ""}`;
}
