INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.value FROM roles r,json_each('["sea.message.moderate_any","sea.user.mute_any"]') p
WHERE r.key IN ('admin','super_admin')
ON CONFLICT(role_id,permission_key) DO NOTHING;
