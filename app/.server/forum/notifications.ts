import type { ForumRuntime } from "./runtime";

// Only rows created by the current publication token can produce a reply event.
export function replyNotificationStatement(
  ctx: ForumRuntime,
  kind: "post" | "comment",
  actorId: number,
  token: string,
) {
  const source =
    kind === "post"
      ? `SELECT p.id AS post_id,NULL AS comment_id,p.topic_id,t.user_id AS recipient
       FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id WHERE p.user_id=? AND p.revision=? AND p.post_number>1`
      : `SELECT p.id AS post_id,c.id AS comment_id,p.topic_id,
         CASE WHEN c.reply_to_id IS NULL THEN p.user_id ELSE target.user_id END AS recipient
       FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id
       LEFT JOIN forum_post_comments target ON target.id=c.reply_to_id AND target.post_id=c.post_id
       WHERE c.user_id=? AND c.revision=?`;
  return ctx.db
    .prepare(
      `INSERT INTO inbox_items
    (type,sender_user_id,recipient_user_id,title,body,event_key,forum_topic_id,forum_post_id,forum_comment_id)
    SELECT 'forum_reply',?,s.recipient,'','',
      'reply:${kind}:'||COALESCE(s.comment_id,s.post_id)||':'||s.recipient,s.topic_id,s.post_id,s.comment_id
    FROM (${source}) s JOIN users recipient ON recipient.id=s.recipient AND recipient.status='active'
    WHERE s.recipient<>? ON CONFLICT(event_key) DO NOTHING`,
    )
    .bind(actorId, actorId, token, actorId);
}

// Must immediately follow the like INSERT in the same batch. The event survives unlike/re-like.
export function likeNotificationStatement(
  ctx: ForumRuntime,
  actorId: number,
  postId: number,
) {
  return ctx.db
    .prepare(
      `INSERT INTO inbox_items
    (type,sender_user_id,recipient_user_id,title,body,event_key,forum_topic_id,forum_post_id)
    SELECT 'forum_like',?,p.user_id,'','','like:'||?||':'||p.id||':'||p.user_id,p.topic_id,p.id
    FROM forum_public_posts p JOIN users recipient ON recipient.id=p.user_id AND recipient.status='active'
    WHERE p.id=? AND p.user_id<>? AND changes()=1 ON CONFLICT(event_key) DO NOTHING`,
    )
    .bind(actorId, actorId, postId, actorId);
}
