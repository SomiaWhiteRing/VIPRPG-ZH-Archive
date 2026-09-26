-- Extend the purpose constraint while preserving existing challenges and IDs.
CREATE TABLE email_verification_challenges_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset', 'email_change', 'account_delete')),
  code_hash TEXT NOT NULL,
  pending_password_hash TEXT,
  pending_display_name TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 1,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO email_verification_challenges_next (
  id, user_id, email, purpose, code_hash, pending_password_hash,
  pending_display_name, expires_at, consumed_at, attempt_count, send_count,
  ip_hash, user_agent_hash, created_at, last_sent_at
)
SELECT
  id, user_id, email, purpose, code_hash, pending_password_hash,
  pending_display_name, expires_at, consumed_at, attempt_count, send_count,
  ip_hash, user_agent_hash, created_at, last_sent_at
FROM email_verification_challenges;

-- Keep the high-water mark even when older challenges have been cleaned up.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
  (SELECT seq FROM sqlite_sequence WHERE name = 'email_verification_challenges'), 0
)) WHERE name = 'email_verification_challenges_next';

DROP TABLE email_verification_challenges;
ALTER TABLE email_verification_challenges_next RENAME TO email_verification_challenges;

CREATE INDEX idx_email_verification_challenges_email
  ON email_verification_challenges(email, created_at);
CREATE INDEX idx_email_verification_challenges_user
  ON email_verification_challenges(user_id, purpose, created_at);
CREATE INDEX idx_email_verification_challenges_expires
  ON email_verification_challenges(expires_at);
