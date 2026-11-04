import { HttpError } from './http';

export const MAX_REJECTION_REASON_LENGTH = 1000;

export function normalizeRejectionReason(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new HttpError(400, '驳回理由必须为纯文本。');
  const reason = value.replace(/\r\n?/g, '\n').trim();
  if (reason.length > MAX_REJECTION_REASON_LENGTH)
    throw new HttpError(400, `驳回理由不能超过 ${MAX_REJECTION_REASON_LENGTH} 字。`);
  return reason;
}

export const INBOX_PAGE_SIZE = 30;
export const INBOX_CATEGORIES = ["all", "comments", "replies", "forum", "likes", "friends", "system", "pending"] as const;
export type InboxCategory = typeof INBOX_CATEGORIES[number];

export function inboxCategory(value: unknown): InboxCategory {
  return INBOX_CATEGORIES.find((category) => category === value) ?? "all";
}

export function inboxHref(category: InboxCategory, page = 1) {
  const query = new URLSearchParams();
  if (category !== "all") query.set("category", category);
  if (page > 1) query.set("page", String(page));
  return `/inbox${query.size ? `?${query}` : ""}`;
}
