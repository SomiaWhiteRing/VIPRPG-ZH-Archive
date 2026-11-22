ALTER TABLE timeline_events ADD COLUMN join_name TEXT CHECK(join_name IS NULL OR kind='join');

DROP TRIGGER timeline_account_history_update;

-- Recover names from a consumed registration challenge matched to the original
-- successful registration audit. Retried or ambiguous challenges cannot supply a name.
UPDATE timeline_events AS joined
SET join_name=COALESCE(
  (
    SELECT MIN(challenge.pending_display_name)
    FROM email_verification_challenges challenge
    WHERE challenge.email=(
      SELECT registration.email
      FROM auth_audit_logs registration INDEXED BY idx_auth_audit_logs_created_at_id
      WHERE registration.user_id=joined.user_id AND registration.event_type='register_verified'
        AND datetime(registration.created_at) BETWEEN joined.created_at AND datetime(joined.created_at,'+10 seconds')
      ORDER BY datetime(registration.created_at),registration.id LIMIT 1
    )
      AND challenge.purpose='register' AND challenge.pending_display_name<>''
      AND challenge.created_at BETWEEN datetime(joined.created_at,'-610 seconds') AND joined.created_at
      AND challenge.consumed_at BETWEEN datetime(joined.created_at,'-10 seconds') AND joined.created_at
    HAVING COUNT(DISTINCT challenge.pending_display_name)=1
  ),
  (
    SELECT json_extract(audit.detail_json,'$.oldDisplayName')
    FROM auth_audit_logs audit
    WHERE audit.user_id=joined.user_id AND audit.event_type='display_name_changed'
    ORDER BY audit.created_at,audit.id LIMIT 1
  ),
  (
    SELECT history.previous_name FROM timeline_events history
    WHERE history.user_id=joined.user_id AND history.kind='rename' AND history.hidden_at IS NULL
    ORDER BY history.created_at,history.id LIMIT 1
  ),
  (SELECT display_name FROM users WHERE id=joined.user_id AND status<>'deleted')
)
WHERE joined.kind='join';

CREATE TRIGGER timeline_account_history_update BEFORE UPDATE ON timeline_events
WHEN OLD.kind IN ('join','rename') OR NEW.kind IN ('join','rename')
BEGIN SELECT RAISE(ABORT,'account timeline history is permanent'); END;

DROP TRIGGER timeline_user_join;
CREATE TRIGGER timeline_user_join AFTER INSERT ON users
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,created_at,updated_at,join_name)
  VALUES(NEW.id,'join','加入了VIPRPG.org','account-join:'||NEW.id,NEW.created_at,NEW.created_at,
    CASE WHEN NEW.status<>'deleted' THEN NEW.display_name END);
END;
