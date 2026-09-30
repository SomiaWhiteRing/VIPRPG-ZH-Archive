-- Keep ordinary-comment notifications as live references, like reply notices.
ALTER TABLE inbox_items ADD COLUMN like_comment_id INTEGER REFERENCES comments(id);

-- A deleted parent loses its body, while its existing published replies stay readable.
DROP VIEW public_comments;
CREATE VIEW public_comments AS
SELECT c.* FROM comments c
JOIN users u ON u.id=c.user_id
JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
JOIN users root_user ON root_user.id=root.user_id
WHERE c.status='published' AND root.status IN ('published','deleted')
  AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
  AND (EXISTS (SELECT 1 FROM public_works w WHERE w.id=c.work_id)
    OR EXISTS (SELECT 1 FROM creators cr WHERE cr.id=c.creator_id AND cr.public_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM characters ch WHERE ch.id=c.character_id));

-- Existing replies remain readable after deletion; new replies still need a public parent.
CREATE TRIGGER comments_require_public_reply_insert
BEFORE INSERT ON comments
WHEN NEW.root_comment_id IS NOT NULL AND (
  NOT EXISTS (SELECT 1 FROM public_comments root WHERE root.id=NEW.root_comment_id)
  OR (NEW.reply_to_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_comments target WHERE target.id=NEW.reply_to_comment_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'comment reply target unavailable');
END;
