import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWrangler } from "./run-wrangler.mjs";

const database = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
const tempDir = mkdtempSync(join(tmpdir(), "viprpg-security-d1-"));
const rootFailureSql = join(tempDir, "root-must-fail.sql");
const checksSql = join(tempDir, "checks.sql");

try {
  writeFileSync(rootFailureSql, `
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u CROSS JOIN roles r
WHERE u.email = 'user@dev.local' AND r.key = 'super_admin';
`, "utf8");
  let duplicateRootRejected = false;
  try {
    await runWrangler(["d1", "execute", database, "--local", "--file", rootFailureSql]);
  } catch {
    duplicateRootRejected = true;
  }
  if (!duplicateRootRejected) throw new Error("duplicate bootstrap admin assignment was accepted");

  writeFileSync(checksSql, `
CREATE TABLE IF NOT EXISTS _security_assertions (
  value INTEGER NOT NULL CHECK (value = 1)
);
DELETE FROM _security_assertions;

INSERT INTO _security_assertions
SELECT COUNT(*) = 4 FROM roles WHERE kind IN ('built_in', 'bootstrap_admin');
INSERT INTO _security_assertions
SELECT COUNT(*) = 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
WHERE r.kind = 'bootstrap_admin';
INSERT INTO _security_assertions
SELECT COUNT(*) = (SELECT COUNT(*) FROM users)
FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'user';
INSERT INTO _security_assertions
SELECT
  (SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'super_admin') =
    (SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'admin') + 2
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions admin_grant
    JOIN roles admin_role ON admin_role.id = admin_grant.role_id AND admin_role.key = 'admin'
    LEFT JOIN role_permissions super_grant
      ON super_grant.role_id = (SELECT id FROM roles WHERE key = 'super_admin')
      AND super_grant.permission_key = admin_grant.permission_key
    WHERE super_grant.role_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions super_grant
    JOIN roles super_role ON super_role.id = super_grant.role_id AND super_role.key = 'super_admin'
    LEFT JOIN role_permissions admin_grant
      ON admin_grant.role_id = (SELECT id FROM roles WHERE key = 'admin')
      AND admin_grant.permission_key = super_grant.permission_key
    WHERE admin_grant.role_id IS NULL
      AND super_grant.permission_key NOT IN ('storage.gc.sweep', 'audit.read')
  )
  AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.key = 'super_admin' AND rp.permission_key = 'storage.gc.sweep'
  )
  AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.key = 'super_admin' AND rp.permission_key = 'audit.read'
  );

DELETE FROM user_sessions WHERE session_hash LIKE 'security-check-%';
INSERT INTO user_sessions (user_id, session_hash, expires_at)
SELECT id, 'security-check-live', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day') FROM users WHERE email = 'user@dev.local';
INSERT INTO user_sessions (user_id, session_hash, expires_at)
SELECT id, 'security-check-expired', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day') FROM users WHERE email = 'user@dev.local';
INSERT INTO _security_assertions
SELECT COUNT(*) = 1 FROM user_sessions
WHERE session_hash LIKE 'security-check-%' AND revoked_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP;
UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = 'user@dev.local');
INSERT INTO _security_assertions
SELECT COUNT(*) = 0 FROM user_sessions
WHERE session_hash LIKE 'security-check-%' AND revoked_at IS NULL;

DELETE FROM email_verification_challenges WHERE code_hash = 'security-check-code';
INSERT INTO email_verification_challenges (email, purpose, code_hash, expires_at)
VALUES ('user@dev.local', 'password_reset', 'security-check-code', datetime('now', '+10 minutes'));
UPDATE email_verification_challenges SET consumed_at = CURRENT_TIMESTAMP
WHERE code_hash = 'security-check-code' AND consumed_at IS NULL;
INSERT INTO _security_assertions SELECT changes() = 1;
UPDATE email_verification_challenges SET consumed_at = CURRENT_TIMESTAMP
WHERE code_hash = 'security-check-code' AND consumed_at IS NULL;
INSERT INTO _security_assertions SELECT changes() = 0;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u CROSS JOIN roles r
WHERE u.email = 'user@dev.local' AND r.key = 'uploader';
INSERT INTO user_role_events (
  event_key, actor_user_id, target_user_id, action, role_id,
  role_key_snapshot, role_name_snapshot, reason
)
SELECT 'security-d1-check-role', actor.id, target.id, 'assigned', r.id,
  r.key, r.name, 'security_d1_check'
FROM users actor CROSS JOIN users target CROSS JOIN roles r
WHERE actor.email = 'admin@dev.local' AND target.email = 'user@dev.local' AND r.key = 'uploader';
INSERT INTO inbox_items (
  type, status, sender_user_id, recipient_user_id, target_user_id, role_event_id, title, body
)
SELECT 'role_change_notice', 'open', actor.id, target.id, target.id, event.id,
  'security check', 'security check'
FROM users actor CROSS JOIN users target CROSS JOIN user_role_events event
WHERE actor.email = 'admin@dev.local' AND target.email = 'user@dev.local'
  AND event.event_key = 'security-d1-check-role';
INSERT INTO auth_audit_logs (user_id, email, event_type)
SELECT id, email, 'security_d1_check' FROM users WHERE email = 'admin@dev.local';
INSERT INTO _security_assertions
SELECT COUNT(*) = 1 FROM inbox_items i JOIN user_role_events e ON e.id = i.role_event_id
WHERE e.event_key = 'security-d1-check-role';
INSERT INTO _security_assertions
SELECT COUNT(*) = 1 FROM auth_audit_logs WHERE event_type = 'security_d1_check';

DELETE FROM inbox_items WHERE role_event_id = (SELECT id FROM user_role_events WHERE event_key = 'security-d1-check-role');
DELETE FROM auth_audit_logs WHERE event_type = 'security_d1_check';
DELETE FROM user_role_events WHERE event_key = 'security-d1-check-role';
DELETE FROM user_roles
WHERE user_id = (SELECT id FROM users WHERE email = 'user@dev.local')
  AND role_id = (SELECT id FROM roles WHERE key = 'uploader');
DELETE FROM email_verification_challenges WHERE code_hash = 'security-check-code';
DELETE FROM user_sessions WHERE session_hash LIKE 'security-check-%';
DROP TABLE _security_assertions;
`, "utf8");
  await runWrangler(["d1", "execute", database, "--local", "--file", checksSql]);
  console.log("D1 security self-check passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
