CREATE TABLE user_block_settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  blocked_user_id INTEGER NOT NULL REFERENCES users(id),
  block_private_messages INTEGER NOT NULL DEFAULT 0 CHECK(block_private_messages IN(0,1)),
  mute_comments INTEGER NOT NULL DEFAULT 0 CHECK(mute_comments IN(0,1)),
  mute_replies INTEGER NOT NULL DEFAULT 0 CHECK(mute_replies IN(0,1)),
  mute_likes INTEGER NOT NULL DEFAULT 0 CHECK(mute_likes IN(0,1)),
  mute_friends INTEGER NOT NULL DEFAULT 0 CHECK(mute_friends IN(0,1)),
  PRIMARY KEY(user_id,blocked_user_id),
  CHECK(user_id<>blocked_user_id)
);

INSERT INTO user_block_settings(user_id,blocked_user_id,block_private_messages)
SELECT s.user_id,CASE WHEN c.lower_user_id=s.user_id THEN c.upper_user_id ELSE c.lower_user_id END,1
FROM direct_conversation_states s JOIN direct_conversations c ON c.id=s.conversation_id WHERE s.receive_messages=0;
-- 发布切换期间旧 Worker 仍读取此列；当前代码统一使用 user_block_settings。

ALTER TABLE inbox_items ADD COLUMN interaction_kind TEXT CHECK(interaction_kind IN('comment','reply','like','friend'));
ALTER TABLE inbox_items ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN(0,1));

UPDATE inbox_items SET interaction_kind=CASE
  WHEN json_extract(metadata_json,'$.mention')=1 THEN 'reply'
  WHEN type='forum_like' OR like_comment_id IS NOT NULL OR (timeline_event_id IS NOT NULL AND timeline_reply_id IS NULL) THEN 'like'
  WHEN type='forum_reply' OR reply_comment_id IS NOT NULL OR timeline_reply_id IS NOT NULL THEN 'reply'
  WHEN type='system_notice' AND json_extract(metadata_json,'$.friend') IN('added','returned') THEN 'friend'
  WHEN work_comment_id IS NOT NULL THEN 'comment'
END
WHERE recipient_user_id IS NOT NULL AND sender_user_id IS NOT NULL AND required_permission_key IS NULL
  AND work_maintainer_request_id IS NULL AND type IN('system_notice','forum_reply','forum_like')
  AND json_extract(metadata_json,'$.reportKind') IS NULL;

DROP TRIGGER web_push_inbox_created;
CREATE TRIGGER web_push_inbox_created AFTER INSERT ON inbox_items
WHEN NEW.suppressed=0 AND (EXISTS(SELECT 1 FROM web_push_subscriptions WHERE user_id=NEW.recipient_user_id)
  OR ((NEW.required_permission_key IS NOT NULL OR NEW.type='role_change_request' OR NEW.work_maintainer_request_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM web_push_subscriptions)))
BEGIN
  INSERT INTO web_push_outbox(kind,event_id) VALUES('inbox',NEW.id);
END;
