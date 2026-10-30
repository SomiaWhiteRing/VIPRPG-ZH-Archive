import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { bodyEmojis } from "@/app/.server/emojis/service";
import type { AppRuntime } from "@/app/.server/runtime";
import { memoizeRequest } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { DirectConversation, DirectMessage, DirectMessagePage, MessagePeer } from "@/lib/dto/db/messages";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { emojiIds, emojiText } from "@/lib/face-emojis";
import { HttpError } from "@/lib/http";
import { MESSAGE_PAGE_SIZE } from "@/lib/messages";

type MessageRow = {
  id: number; sender_user_id: number; recipient_user_id: number; conversation_id: number;
  kind: "text" | "image"; body: string | null; created_at: string;
  width: number | null; height: number | null;
};
const columns = `m.id,m.conversation_id,m.sender_user_id,m.recipient_user_id,m.kind,m.body,m.created_at,i.width,i.height`;
const joins = "FROM direct_messages m LEFT JOIN direct_message_images i ON i.id=m.image_id";

function mapMessage(row: MessageRow): DirectMessage {
  return { id: row.id, senderUserId: row.sender_user_id, kind: row.kind, body: row.body ?? "", createdAt: row.created_at,
    image: row.kind === "image" ? { url: `/api/messages/images/${row.id}`, width: row.width!, height: row.height! } : null };
}

export async function directMessagePeer(runtime: AppRuntime, user: ArchiveUser, peerId: number): Promise<MessagePeer> {
  if (peerId === user.id) throw new HttpError(404, "会话不存在");
  const row = await runtime.db.prepare(`SELECT u.id,u.display_name,u.avatar_blob_sha256,u.status,u.receive_private_messages,
    EXISTS(SELECT 1 FROM direct_conversations c JOIN direct_messages m ON m.conversation_id=c.id
      WHERE c.lower_user_id=MIN(?,u.id) AND c.upper_user_id=MAX(?,u.id)) AS has_history
    FROM users u WHERE u.id=?`).bind(user.id, user.id, peerId)
    .first<{ id: number; display_name: string; avatar_blob_sha256: string | null; status: string; receive_private_messages: number; has_history: number }>();
  if (!row || (!row.has_history && (row.status !== "active" || row.receive_private_messages !== 1)))
    throw new HttpError(404, "会话不存在");
  return { id: row.id, displayName: row.display_name, avatarBlobSha256: row.avatar_blob_sha256,
    canSend: row.status === "active" && row.receive_private_messages === 1 && hasPermission(user, "message.send") };
}

export async function listDirectConversations(runtime: AppRuntime, user: ArchiveUser, before = Number.MAX_SAFE_INTEGER) {
  const rows = await runtime.db.prepare(`SELECT u.id AS peer_id,u.display_name,u.avatar_blob_sha256,
    m.id AS last_id,m.kind,m.body,m.created_at,
    (SELECT COUNT(*) FROM direct_messages unread WHERE unread.conversation_id=c.id AND unread.recipient_user_id=?
      AND unread.id>COALESCE(s.last_read_message_id,0)) AS unread
    FROM direct_conversation_states s JOIN direct_conversations c ON c.id=s.conversation_id
    JOIN users u ON u.id=CASE WHEN c.lower_user_id=? THEN c.upper_user_id ELSE c.lower_user_id END
    JOIN direct_messages m ON m.id=(SELECT MAX(last.id) FROM direct_messages last WHERE last.conversation_id=c.id)
    WHERE s.user_id=? AND m.id<? ORDER BY m.id DESC LIMIT 31`).bind(user.id, user.id, user.id, before)
    .all<{ peer_id: number; display_name: string; avatar_blob_sha256: string | null;
      last_id: number; kind: string; body: string | null; created_at: string; unread: number }>();
  const selected = rows.results.slice(0, 30);
  const conversations: DirectConversation[] = selected.map(row => ({
    peer: { id: row.peer_id, displayName: row.display_name, avatarBlobSha256: row.avatar_blob_sha256 },
    excerpt: row.kind === "image" ? "[图片]" : emojiText(row.body ?? "").slice(0, 120),
    updatedAt: row.created_at, unread: row.unread,
  }));
  return { conversations, nextCursor: rows.results.length > 30 ? selected.at(-1)!.last_id : null };
}

export async function listDirectMessages(runtime: AppRuntime, user: ArchiveUser, peerId: number,
  position: { before?: number; after?: number } = {}): Promise<DirectMessagePage> {
  const peer = await directMessagePeer(runtime, user, peerId);
  const newer = position.after !== undefined;
  const rows = await runtime.db.prepare(`SELECT ${columns} ${joins}
    JOIN direct_conversations c ON c.id=m.conversation_id
    WHERE c.lower_user_id=MIN(?,?) AND c.upper_user_id=MAX(?,?) AND m.id${newer ? ">" : "<"}?
    ORDER BY m.id ${newer ? "ASC" : "DESC"} LIMIT ?`)
    .bind(user.id, peerId, user.id, peerId, position.after ?? position.before ?? Number.MAX_SAFE_INTEGER, MESSAGE_PAGE_SIZE + 1)
    .all<MessageRow>();
  const selected = rows.results.slice(0, MESSAGE_PAGE_SIZE);
  if (!newer) selected.reverse();
  return { peer, messages: selected.map(mapMessage), emojis: await bodyEmojis(runtime.db, selected.map(row => row.body)),
    hasOlder: !newer && rows.results.length > MESSAGE_PAGE_SIZE };
}

export function countUnreadDirectMessages(runtime: AppRuntime, userId: number): Promise<number> {
  return memoizeRequest(runtime, `direct-unread:${userId}`, async () => {
    const row = await runtime.db.prepare(`SELECT COUNT(*) AS count FROM direct_conversation_states s
      JOIN direct_messages m ON m.conversation_id=s.conversation_id AND m.recipient_user_id=s.user_id
        AND m.id>COALESCE(s.last_read_message_id,0) WHERE s.user_id=?`).bind(userId).first<{ count: number }>();
    return row?.count ?? 0;
  });
}

export async function findSentDirectMessage(runtime: AppRuntime, senderId: number, peerId: number,
  input: { clientId: string } & ({ kind: "text"; body: string } | { kind: "image" })) {
  const existing = await runtime.db.prepare(`SELECT ${columns} ${joins} WHERE m.sender_user_id=? AND m.client_id=?`)
    .bind(senderId, input.clientId).first<MessageRow>();
  if (!existing) return null;
  if (existing.recipient_user_id !== peerId || existing.kind !== input.kind
    || (input.kind === "text" && existing.body !== input.body)) throw new HttpError(409, "消息编号已用于其他内容");
  return mapMessage(existing);
}

export async function sendDirectMessage(runtime: AppRuntime, user: ArchiveUser, peerId: number,
  input: { clientId: string } & ({ kind: "text"; body: string } | { kind: "image"; imageId: string })) {
  const existing = await findSentDirectMessage(runtime, user.id, peerId, input);
  if (existing) return existing;
  const peer = await directMessagePeer(runtime, user, peerId);
  if (!peer.canSend) throw new HttpError(403, "无法向此用户发送短信");
  const db = runtime.db;
  const ids = input.kind === "text" ? emojiIds(input.body) : [];
  const allowed = `EXISTS(SELECT 1 FROM users recipient WHERE recipient.id=? AND recipient.status='active'
      AND recipient.receive_private_messages=1) AND ${userPermissionSql(String(user.id), "message.send")}`;
  await db.batch([
    db.prepare(`INSERT INTO direct_conversations(lower_user_id,upper_user_id)
      SELECT MIN(?,?),MAX(?,?) WHERE ${allowed} ON CONFLICT(lower_user_id,upper_user_id) DO NOTHING`)
      .bind(user.id, peerId, user.id, peerId, peerId),
    db.prepare(`INSERT INTO direct_conversation_states(conversation_id,user_id)
      SELECT id,lower_user_id FROM direct_conversations WHERE lower_user_id=MIN(?,?) AND upper_user_id=MAX(?,?)
      UNION ALL SELECT id,upper_user_id FROM direct_conversations WHERE lower_user_id=MIN(?,?) AND upper_user_id=MAX(?,?)
      ON CONFLICT(conversation_id,user_id) DO NOTHING`).bind(user.id, peerId, user.id, peerId, user.id, peerId, user.id, peerId),
    db.prepare(`INSERT INTO direct_messages(conversation_id,sender_user_id,recipient_user_id,client_id,kind,body,image_id)
      SELECT c.id,?,?,?,?,?,? FROM direct_conversations c WHERE c.lower_user_id=MIN(?,?) AND c.upper_user_id=MAX(?,?)
        AND ${allowed}
        AND (SELECT COUNT(*) FROM direct_messages recent WHERE recent.sender_user_id=? AND recent.created_at>=datetime('now','-1 minute'))<30
        AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM available_face_emojis a WHERE a.id=e.value))
      ON CONFLICT(sender_user_id,client_id) DO NOTHING`)
      .bind(user.id, peerId, input.clientId, input.kind, input.kind === "text" ? input.body : null,
        input.kind === "image" ? input.imageId : null, user.id, peerId, user.id, peerId, peerId, user.id, JSON.stringify(ids)),
    db.prepare(`INSERT INTO direct_message_emojis(message_id,emoji_id)
      SELECT m.id,e.value FROM direct_messages m,json_each(?) e WHERE m.sender_user_id=? AND m.client_id=?
      ON CONFLICT(message_id,emoji_id) DO NOTHING`).bind(JSON.stringify(ids), user.id, input.clientId),
    db.prepare(`UPDATE direct_message_images SET state='ready' WHERE id=(SELECT image_id FROM direct_messages
      WHERE sender_user_id=? AND client_id=?) AND state='uploading'`).bind(user.id, input.clientId),
  ]);
  const sent = await findSentDirectMessage(runtime, user.id, peerId, input);
  if (!sent) throw new HttpError(429, "发送未完成，请稍后重试");
  // D1 owns the message. The room only wakes briefly to send a change event.
  runtime.execution.waitUntil(runtime.env.MESSAGE_ROOM.getByName(`${Math.min(user.id, peerId)}:${Math.max(user.id, peerId)}`)
    .changed().catch(error => console.error("Private message notification failed", error)));
  return sent;
}

export async function markDirectMessagesRead(runtime: AppRuntime, userId: number, peerId: number, through: number) {
  await runtime.db.prepare(`UPDATE direct_conversation_states SET last_read_message_id=?
    WHERE user_id=? AND COALESCE(last_read_message_id,0)<?
      AND conversation_id=(SELECT m.conversation_id FROM direct_messages m WHERE m.id=?
        AND ((m.sender_user_id=? AND m.recipient_user_id=?) OR (m.sender_user_id=? AND m.recipient_user_id=?)))`)
    .bind(through, userId, through, through, userId, peerId, peerId, userId).run();
}
