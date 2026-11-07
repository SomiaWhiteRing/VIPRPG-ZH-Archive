import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import type { UserBlockSettings } from "@/lib/user-blocks";

const columns: Record<keyof UserBlockSettings, string> = {
  blockPrivateMessages: "block_private_messages", muteComments: "mute_comments",
  muteReplies: "mute_replies", muteMentions: "mute_mentions", muteLikes: "mute_likes", muteFriends: "mute_friends",
};

// Expressions are supplied by the notification writers, never by request input.
export function interactionSuppressedSql(recipient: string, actor: string, kind: string, alsoMention = "0"): string {
  return `EXISTS(SELECT 1 FROM user_block_settings blocks WHERE blocks.user_id=${recipient}
    AND blocks.blocked_user_id=${actor} AND CASE ${kind}
      WHEN 'comment' THEN blocks.mute_comments WHEN 'reply' THEN blocks.mute_replies
      WHEN 'mention' THEN blocks.mute_mentions
      WHEN 'like' THEN blocks.mute_likes WHEN 'friend' THEN blocks.mute_friends ELSE 0 END=1
      AND (COALESCE(${alsoMention},0)=0 OR blocks.mute_mentions=1))`;
}

export async function readUserBlockSettings(runtime: AppRuntime, userId: number, peerId: number): Promise<UserBlockSettings> {
  const row = await runtime.db.prepare(`SELECT block_private_messages,mute_comments,mute_replies,mute_mentions,mute_likes,mute_friends
    FROM user_block_settings WHERE user_id=? AND blocked_user_id=?`).bind(userId, peerId)
    .first<Record<string, number>>();
  return { blockPrivateMessages: row?.block_private_messages === 1, muteComments: row?.mute_comments === 1,
    muteReplies: row?.mute_replies === 1, muteMentions: row?.mute_mentions === 1,
    muteLikes: row?.mute_likes === 1, muteFriends: row?.mute_friends === 1 };
}

export async function setUserBlockSettings(runtime: AppRuntime, user: ArchiveUser, peerId: number,
  patch: Partial<UserBlockSettings>): Promise<UserBlockSettings> {
  if (user.id === peerId) throw new HttpError(400, "不能屏蔽自己");
  if (!await runtime.db.prepare("SELECT 1 FROM users WHERE id=?").bind(peerId).first())
    throw new HttpError(404, "用户不存在");
  const entries = (Object.keys(patch) as (keyof UserBlockSettings)[]).map(key => ({ column: columns[key], value: patch[key] ? 1 : 0 }));
  const db = runtime.db;
  await db.batch([
    db.prepare(`INSERT INTO user_block_settings(user_id,blocked_user_id,${entries.map(entry => entry.column).join(",")})
      VALUES(?,?,${entries.map(() => "?").join(",")}) ON CONFLICT(user_id,blocked_user_id) DO UPDATE SET
      ${entries.map(entry => `${entry.column}=excluded.${entry.column}`).join(",")}`)
      .bind(user.id, peerId, ...entries.map(entry => entry.value)),
    db.prepare(`INSERT INTO inbox_item_reads(item_id,user_id,read_at)
      SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE i.recipient_user_id=? AND i.sender_user_id=?
        AND i.suppressed=0 AND ${interactionSuppressedSql("i.recipient_user_id", "i.sender_user_id",
          "CASE WHEN json_extract(i.metadata_json,'$.mention')=1 THEN 'mention' ELSE i.interaction_kind END",
          "json_extract(i.metadata_json,'$.alsoMention')")}
        AND NOT EXISTS(SELECT 1 FROM inbox_item_reads r WHERE r.item_id=i.id AND r.user_id=?)
      ON CONFLICT(item_id,user_id) DO NOTHING`).bind(user.id, user.id, peerId, user.id),
    ...(patch.blockPrivateMessages ? [db.prepare(`UPDATE direct_conversation_states AS s SET last_read_message_id=
      (SELECT MAX(m.id) FROM direct_messages m WHERE m.conversation_id=s.conversation_id AND (m.sender_user_id=s.user_id OR m.delivered=1))
      WHERE s.user_id=? AND s.conversation_id IN (SELECT id FROM direct_conversations
        WHERE lower_user_id=MIN(?,?) AND upper_user_id=MAX(?,?))
        AND EXISTS(SELECT 1 FROM direct_messages m WHERE m.conversation_id=s.conversation_id
          AND (m.sender_user_id=s.user_id OR m.delivered=1) AND m.id>COALESCE(s.last_read_message_id,0))`)
      .bind(user.id, user.id, peerId, user.id, peerId)] : []),
    db.prepare(`DELETE FROM user_block_settings WHERE user_id=? AND blocked_user_id=?
      AND block_private_messages=0 AND mute_comments=0 AND mute_replies=0 AND mute_mentions=0 AND mute_likes=0 AND mute_friends=0`)
      .bind(user.id, peerId),
  ]);
  if (patch.blockPrivateMessages !== undefined) runtime.execution.waitUntil(runtime.env.MESSAGE_ROOM
    .getByName(`${Math.min(user.id, peerId)}:${Math.max(user.id, peerId)}`).changed()
    .catch(error => console.error("Private message notification failed", error)));
  return readUserBlockSettings(runtime, user.id, peerId);
}
