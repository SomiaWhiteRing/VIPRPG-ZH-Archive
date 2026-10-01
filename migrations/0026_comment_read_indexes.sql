-- Roots include deleted placeholders; floors also include hidden roots.
-- The old published-only indexes cannot serve either contract.
DROP INDEX idx_comments_work_public_roots;
DROP INDEX idx_comments_creator_public_roots;
DROP INDEX idx_comments_character_public_roots;
DROP INDEX idx_comments_replies;

CREATE INDEX idx_comments_work_roots
  ON comments(work_id, created_at, id)
  WHERE work_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_creator_roots
  ON comments(creator_id, created_at, id)
  WHERE creator_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_character_roots
  ON comments(character_id, created_at, id)
  WHERE character_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_replies
  ON comments(root_comment_id, created_at, id)
  WHERE root_comment_id IS NOT NULL;
