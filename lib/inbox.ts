export const INBOX_PAGE_SIZE = 30;
export const INBOX_CATEGORIES = ["all", "replies", "likes", "system", "pending"] as const;
export type InboxCategory = typeof INBOX_CATEGORIES[number];

export function inboxCategory(value: unknown): InboxCategory {
  return INBOX_CATEGORIES.find((category) => category === value) ?? "all";
}

export function inboxHref(category: InboxCategory, unread: boolean, page = 1) {
  const query = new URLSearchParams();
  if (category !== "all") query.set("category", category);
  if (unread) query.set("unread", "1");
  if (page > 1) query.set("page", String(page));
  return `/inbox${query.size ? `?${query}` : ""}`;
}
