ALTER TABLE users ADD COLUMN receive_private_messages INTEGER NOT NULL DEFAULT 1
  CHECK(receive_private_messages IN (0,1));

INSERT INTO role_permissions(role_id,permission_key)
SELECT id,'message.send' FROM roles WHERE key='user';

CREATE TABLE direct_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lower_user_id INTEGER NOT NULL REFERENCES users(id),
  upper_user_id INTEGER NOT NULL REFERENCES users(id),
  CHECK(lower_user_id<upper_user_id),
  UNIQUE(lower_user_id,upper_user_id)
);

CREATE TABLE direct_conversation_states (
  conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_read_message_id INTEGER,
  PRIMARY KEY(conversation_id,user_id),
  FOREIGN KEY(last_read_message_id,conversation_id) REFERENCES direct_messages(id,conversation_id)
);
CREATE INDEX direct_states_user ON direct_conversation_states(user_id,conversation_id);
CREATE TRIGGER direct_state_participant BEFORE INSERT ON direct_conversation_states
WHEN NOT EXISTS(SELECT 1 FROM direct_conversations c WHERE c.id=NEW.conversation_id
  AND NEW.user_id IN(c.lower_user_id,c.upper_user_id))
BEGIN SELECT RAISE(ABORT,'invalid_direct_participant'); END;

-- Upload tracking is internal; a completed image creates its own message.
-- Allocate message IDs after upload so incremental readers cannot skip a late image.
CREATE TABLE direct_message_images (
  id TEXT PRIMARY KEY,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK(format IN('png','jpeg','webp','gif')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK(width>0),
  height INTEGER NOT NULL CHECK(height>0),
  state TEXT NOT NULL CHECK(state IN('uploading','ready','cleanup','cleaned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sender_user_id,client_id)
);
CREATE INDEX direct_images_pending ON direct_message_images(state,created_at) WHERE state<>'ready';

CREATE TABLE direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id),
  sender_user_id INTEGER NOT NULL,
  recipient_user_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('text','image')),
  body TEXT,
  image_id TEXT UNIQUE REFERENCES direct_message_images(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(sender_user_id<>recipient_user_id),
  CHECK((kind='text' AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 16000 AND image_id IS NULL)
    OR (kind='image' AND body IS NULL AND image_id IS NOT NULL)),
  UNIQUE(sender_user_id,client_id),
  UNIQUE(id,conversation_id),
  FOREIGN KEY(conversation_id,sender_user_id) REFERENCES direct_conversation_states(conversation_id,user_id),
  FOREIGN KEY(conversation_id,recipient_user_id) REFERENCES direct_conversation_states(conversation_id,user_id)
);
CREATE INDEX direct_messages_history ON direct_messages(conversation_id,id DESC);
CREATE INDEX direct_messages_unread ON direct_messages(recipient_user_id,conversation_id,id);
CREATE INDEX direct_messages_rate ON direct_messages(sender_user_id,created_at);
CREATE TRIGGER direct_message_image_owner BEFORE INSERT ON direct_messages
WHEN NEW.kind='image' AND NOT EXISTS(SELECT 1 FROM direct_message_images i
  WHERE i.id=NEW.image_id AND i.sender_user_id=NEW.sender_user_id
    AND i.recipient_user_id=NEW.recipient_user_id AND i.client_id=NEW.client_id AND i.state IN('uploading','ready'))
BEGIN SELECT RAISE(ABORT,'invalid_direct_image'); END;

CREATE TABLE direct_message_emojis (
  message_id INTEGER NOT NULL REFERENCES direct_messages(id),
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(message_id,emoji_id)
);
