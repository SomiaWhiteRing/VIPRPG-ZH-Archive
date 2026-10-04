import { bodyEmojis } from "@/app/.server/emojis/service";
import { bodyLength, FACE_EMOJI_PATTERN, type FaceEmoji } from "@/lib/face-emojis";
import type { TimelineBodySegment } from "@/lib/dto/db/timeline";
import { mentions } from "@/lib/mentions";
import { HttpError } from "@/lib/http";

export const PUBLIC_STATUS = `SELECT e.id FROM timeline_events e JOIN users u ON u.id=e.user_id
  WHERE e.id=? AND e.kind='status' AND e.hidden_at IS NULL AND u.status='active' AND u.profile_show_timeline=1`;

export function statusBody(input: Record<string, unknown>): string {
  const value = input.body;
  if (typeof value !== "string" || !value.trim() || value.length > 16000 || bodyLength(value.trim()) > 500 || value.includes("\0"))
    throw new HttpError(400, "内容需要 1–500 个字符");
  if (mentions(value).length || /<img\b|!\[[^\]]*\]\(/i.test(value) ||
      (input.images !== undefined && (!Array.isArray(input.images) || input.images.length > 0)) || input.mentions !== undefined)
    throw new HttpError(400, "图片请通过配图上传，吐槽和回复不支持提及");
  return value.trim().replace(/\r\n?/g, "\n");
}

export async function timelineEmojiMap(db: D1Database, bodies: (string | null)[]) {
  return new Map((await bodyEmojis(db, bodies)).map((emoji) => [emoji.id, emoji]));
}

export function timelineBody(body: string, emojis: Map<number, FaceEmoji>, maxLength?: number): TimelineBodySegment[] {
  const segments: TimelineBodySegment[] = [];
  let offset = 0;
  for (const match of body.matchAll(FACE_EMOJI_PATTERN)) {
    if (match.index > offset) segments.push({ type: "text", text: body.slice(offset, match.index) });
    segments.push({ type: "emoji", emoji: emojis.get(Number(match[1])) ?? null });
    offset = match.index + match[0].length;
  }
  if (offset < body.length) segments.push({ type: "text", text: body.slice(offset) });
  if (maxLength === undefined) return segments;
  const excerpt: TimelineBodySegment[] = [];
  let remaining = maxLength;
  for (const segment of segments) {
    const characters = segment.type === "text" ? [...segment.text] : [];
    const length = segment.type === "emoji" ? 1 : characters.length;
    if (length <= remaining) {
      excerpt.push(segment);
      remaining -= length;
    } else {
      if (remaining > 0 && segment.type === "text") excerpt.push({ type: "text", text: characters.slice(0, remaining).join("") });
      excerpt.push({ type: "text", text: "…" });
      break;
    }
  }
  return excerpt;
}
