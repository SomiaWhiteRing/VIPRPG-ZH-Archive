ALTER TABLE direct_conversation_states ADD COLUMN receive_messages INTEGER NOT NULL DEFAULT 1 CHECK(receive_messages IN(0,1));
ALTER TABLE direct_messages ADD COLUMN delivered INTEGER NOT NULL DEFAULT 1 CHECK(delivered IN(0,1));

CREATE TABLE direct_message_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  peer_user_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL REFERENCES direct_conversations(id),
  reason TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','resolved','dismissed')),
  note TEXT NOT NULL DEFAULT '',
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(user_id<>peer_user_id),
  FOREIGN KEY(conversation_id,user_id) REFERENCES direct_conversation_states(conversation_id,user_id),
  FOREIGN KEY(conversation_id,peer_user_id) REFERENCES direct_conversation_states(conversation_id,user_id)
);
CREATE UNIQUE INDEX direct_pending_report ON direct_message_reports(user_id,peer_user_id) WHERE status='pending';
CREATE INDEX direct_reports_queue ON direct_message_reports(status,created_at,id);
CREATE INDEX direct_reports_author_time ON direct_message_reports(user_id,created_at);
