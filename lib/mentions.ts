export type MentionUser = { id: number; displayName: string };
export type MentionSearchUser = MentionUser & { avatarBlobSha256: string | null };

// Encoded labels are snapshots; the immutable ID, never the label, identifies the user.
export const MENTION_PATTERN = /@\[([A-Za-z0-9_.~%!-]{1,1800})\]\(user:([1-9]\d{0,15})\)/g;
export const MENTION_LIMIT = 20;
export function mentionToken(user: MentionUser): string {
  const label = encodeURIComponent(user.displayName).replace(/[!'()*]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `@[${label}](user:${user.id})`;
}
export function readMention(token: string): MentionUser | null {
  const match = new RegExp(`^(?:${MENTION_PATTERN.source})$`).exec(token);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  try {
    const displayName = decodeURIComponent(match[1]);
    if (!displayName || [...displayName].some((character) => character.charCodeAt(0) < 32)) return null;
    return { id: Number(match[2]), displayName };
  } catch { return null; }
}
export function mentions(body: string): MentionUser[] {
  return [...body.matchAll(MENTION_PATTERN)].flatMap((match) => {
    const user = readMention(match[0]);
    return user ? [user] : [];
  });
}
export function mentionText(body: string): string {
  return body.replace(MENTION_PATTERN, (token) => {
    const user = readMention(token);
    return user ? `@${user.displayName}` : token;
  });
}
