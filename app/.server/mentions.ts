import { json as jsonResponse, HttpError } from "@/lib/http";
import { getCurrentUser } from "./auth/current-user";
import { getD1 } from "./db/d1";
import type { AppRuntime } from "./runtime";

import { MENTION_LIMIT, mentions, type MentionSearchUser } from "@/lib/mentions";

export async function searchMentionUsers(runtime: AppRuntime, request: Request) {
  const actor = await getCurrentUser(runtime);
  if (!actor || actor.status !== "active") throw new HttpError(401, "请先登录。");
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 80) throw new HttpError(400, "搜索内容过长。");
  if (!query) return jsonResponse({ ok: true, users: [] }, { headers: { "Cache-Control": "no-store" } });
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await getD1(runtime).prepare(`SELECT id,display_name AS displayName,avatar_blob_sha256 AS avatarBlobSha256 FROM users
    WHERE status='active' AND (display_name LIKE ? ESCAPE '\\' OR id=?)
    ORDER BY CASE WHEN display_name=? THEN 0 ELSE 1 END,display_name COLLATE NOCASE,id LIMIT 20`)
    .bind(pattern, /^[1-9]\d*$/.test(query) && Number.isSafeInteger(Number(query)) ? Number(query) : -1, query)
    .all<MentionSearchUser>();
  return jsonResponse({ ok: true, users: rows.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function validateMentions(db: D1Database, body: string, previous = "") {
  const users = mentions(body);
  const ids = [...new Set(users.map((user) => user.id))];
  if (ids.length > MENTION_LIMIT) throw new HttpError(400, `每条内容最多提及 ${MENTION_LIMIT} 位用户。`);
  const old = new Set(mentions(previous).map((user) => `${user.id}:${user.displayName}`));
  const added = users.filter((user) => !old.has(`${user.id}:${user.displayName}`));
  if (!added.length) return;
  const rows = await db.prepare("SELECT id,display_name FROM users WHERE status='active' AND id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify([...new Set(added.map((user) => user.id))])).all<{ id: number; display_name: string }>();
  const names = new Map(rows.results.map((user) => [user.id, user.display_name]));
  if (added.some((user) => names.get(user.id) !== user.displayName))
    throw new HttpError(409, "被提及用户的资料已变化或不可用，请重新搜索选择。");
}

// Existing inbox references and metadata support mentions without changing the database schema.
// The source must be gated by this write's revision/request identity in the publication batch.
export function mentionNotification(db: D1Database, actorId: number, body: string, previous: string,
  kind: "comment" | "post" | "forum-comment", source: string, args: (number | string)[]) {
  const old = new Set(mentions(previous).map((user) => user.id));
  const ids = [...new Set(mentions(body).map((user) => user.id))].filter((id) => !old.has(id));
  const ordinary = kind === "comment";
  const table = ordinary ? "public_comments" : kind === "post" ? "forum_public_posts" : "forum_public_comments";
  const fields = ordinary ? "work_comment_id" : "forum_topic_id,forum_post_id,forum_comment_id";
  const values = ordinary ? "s.id" : kind === "post" ? "s.topic_id,s.id,NULL" : "s.topic_id,s.post_id,s.id";
  const sameContent = ordinary
    ? "(i.work_comment_id=s.id OR i.reply_comment_id=s.id)"
    : kind === "post" ? "i.forum_post_id=s.id AND i.forum_comment_id IS NULL AND i.type='forum_reply'"
      : "i.forum_comment_id=s.id AND i.type='forum_reply'";
  return db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key,metadata_json,${fields})
    SELECT '${ordinary ? "system_notice" : "forum_reply"}',?,u.id,'','','mention:${kind}:'||s.id||':'||u.id,'{"mention":true}',${values}
    FROM ${table} s JOIN users u ON u.id IN (SELECT value FROM json_each(?)) AND u.status='active'
    WHERE s.id IN (${source}) AND u.id<>? AND NOT EXISTS
      (SELECT 1 FROM inbox_items i WHERE i.recipient_user_id=u.id AND ${sameContent})
    ON CONFLICT(event_key) DO NOTHING`).bind(actorId, JSON.stringify(ids), ...args, actorId);
}
