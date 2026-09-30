-- Registration and profile updates store NFKC-normalized names with collapsed
-- whitespace. Keep disabled accounts' names reserved; deleted accounts retain
-- the shared anonymous name. Existing collisions must be resolved explicitly.
CREATE UNIQUE INDEX idx_users_display_name_unique
  ON users(display_name COLLATE NOCASE)
  WHERE status IN ('active', 'disabled');

-- Record the actual old/new values atomically, including concurrent renames.
-- Account deletion keeps its existing anonymization and deletion audit.
CREATE TRIGGER users_display_name_changed_audit
AFTER UPDATE OF display_name ON users
WHEN NEW.status IN ('active', 'disabled') AND OLD.display_name IS NOT NEW.display_name
BEGIN
  INSERT INTO auth_audit_logs(user_id, email, event_type, detail_json)
  VALUES(NEW.id, NEW.email, 'display_name_changed',
    json_object('oldDisplayName', OLD.display_name, 'newDisplayName', NEW.display_name));
END;
