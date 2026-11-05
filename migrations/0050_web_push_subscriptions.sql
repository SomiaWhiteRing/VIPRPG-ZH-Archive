CREATE TABLE web_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  categories_json TEXT NOT NULL CHECK(json_valid(categories_json) AND json_type(categories_json)='array'),
  inbox_after_id INTEGER NOT NULL DEFAULT 0,
  message_after_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_push_user ON web_push_subscriptions(user_id, id);
CREATE INDEX web_push_session ON web_push_subscriptions(session_id);

CREATE TRIGGER web_push_session_revoked AFTER UPDATE OF revoked_at ON user_sessions
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  DELETE FROM web_push_subscriptions WHERE session_id=NEW.id;
END;

CREATE TABLE web_push_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('inbox','messages')),
  event_id INTEGER NOT NULL,
  UNIQUE(kind,event_id)
);

CREATE TRIGGER web_push_inbox_created AFTER INSERT ON inbox_items
WHEN EXISTS(SELECT 1 FROM web_push_subscriptions WHERE user_id=NEW.recipient_user_id)
  OR ((NEW.required_permission_key IS NOT NULL OR NEW.type='role_change_request' OR NEW.work_maintainer_request_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM web_push_subscriptions))
BEGIN
  INSERT INTO web_push_outbox(kind,event_id) VALUES('inbox',NEW.id);
END;

CREATE TRIGGER web_push_message_created AFTER INSERT ON direct_messages
WHEN NEW.delivered=1 AND EXISTS(SELECT 1 FROM web_push_subscriptions WHERE user_id=NEW.recipient_user_id)
BEGIN
  INSERT INTO web_push_outbox(kind,event_id) VALUES('messages',NEW.id);
END;
