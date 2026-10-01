-- Work information and distribution editing are independent grants.
-- Revoke both from every non-administrator role, including custom roles.
DELETE FROM role_permissions
WHERE permission_key IN ('work.metadata.update_any', 'work.distribution.update_any')
  AND role_id NOT IN (SELECT id FROM roles WHERE key IN ('admin', 'super_admin'));

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT id, 'work.distribution.update_any' FROM roles
WHERE key IN ('admin', 'super_admin');

-- Preserve an individual's existing denial of the formerly combined editor.
INSERT OR IGNORE INTO user_permission_blocks
  (user_id, permission_key, created_by_user_id, created_at)
SELECT user_id, 'work.distribution.update_any', created_by_user_id, created_at
FROM user_permission_blocks WHERE permission_key='work.metadata.update_any';

-- Refresh only the shipped descriptions; preserve administrator customizations.
UPDATE roles SET description='维护作者和游戏角色资料，整理标签、作品关联、角色分类、来源与素材。修改直接生效并记录操作。'
WHERE key='wiki_editor'
  AND description='综合维护作品、作者和游戏角色资料，整理标签、作品关联、角色分类、来源与素材。修改直接生效并记录操作；不包含实体合并、作品上下架、归档文件或账户管理。';

UPDATE roles SET description='维护作品标签及普通和翻译关联，可查看非公开作品资料。作品信息及归档内容/外链编辑权限已收回。'
WHERE key='work_editor'
  AND description='修订作品名称、简介、作者、登场角色、封面等展示资料，维护作品标签及普通和翻译关联。可查看非公开作品资料，不包含发布、隐藏、删除或合并作品，也不能管理归档文件和维护者。';
