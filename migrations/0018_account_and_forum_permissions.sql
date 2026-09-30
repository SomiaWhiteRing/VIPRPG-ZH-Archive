-- Every account keeps the base user role, including future registrations.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.value FROM roles r, json_each('["user.rename_own","forum.use"]') p
WHERE r.key = 'user';

-- A per-user block takes precedence over grants from every role.
CREATE TABLE user_permission_blocks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_key)
);
