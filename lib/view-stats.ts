export type ViewKind = "work" | "topic";

export const VIEW_DAY_MS = 86_400_000;
export const VIEW_DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

// A calendar day in UTC+8, shared by the client hint and server authority.
export function viewDay(now = Date.now()): number {
  return Math.floor((now + VIEW_DAY_OFFSET_MS) / VIEW_DAY_MS);
}
