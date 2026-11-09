ALTER TABLE forum_topics ADD COLUMN saged INTEGER NOT NULL DEFAULT 0 CHECK(saged IN(0,1));

CREATE INDEX forum_topics_sage_activity ON forum_topics(last_activity_at DESC,id DESC)
WHERE saged=1 AND status='published';

INSERT INTO role_permissions(role_id,permission_key)
SELECT id,'forum.topic.sage_any' FROM roles WHERE key IN('admin','super_admin')
ON CONFLICT(role_id,permission_key) DO NOTHING;
