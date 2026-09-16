-- Replace the obsolete private-character read key. Custom roles receive no new write grants.
INSERT OR IGNORE INTO role_permissions(role_id,permission_key)
SELECT role_id,'character.admin.read' FROM role_permissions WHERE permission_key='character.read_private';
DELETE FROM role_permissions WHERE permission_key='character.read_private';

-- Built-in administrators manage all character operations. Custom roles are configured explicitly.
INSERT OR IGNORE INTO role_permissions(role_id,permission_key)
SELECT roles.id,value FROM roles,json_each('["character.admin.read","character.create","character.metadata.update_any","character.merge_any","character.portrait.manage_any","character.portrait.upload","character_category.create","character_category.update","character_category.delete","character_membership.create","character_membership.update","character_membership.delete","character_index.reorder","character.sources.update_any"]')
WHERE roles.key IN ('admin','super_admin');
