-- Comment publication and target access are separate: readers inherit work access.
CREATE VIEW published_comments AS
SELECT c.* FROM comments c
JOIN users u ON u.id=c.user_id
JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
JOIN users root_user ON root_user.id=root.user_id
WHERE c.status='published' AND root.status IN ('published','deleted')
  AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
  AND (EXISTS(SELECT 1 FROM works w WHERE w.id=c.work_id AND w.status='published')
    OR EXISTS(SELECT 1 FROM creators cr WHERE cr.id=c.creator_id AND cr.public_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM characters ch WHERE ch.id=c.character_id));

-- Public feeds and profiles must still exclude restricted works.
DROP VIEW public_comments;
CREATE VIEW public_comments AS
SELECT c.* FROM published_comments c
WHERE c.work_id IS NULL OR EXISTS(SELECT 1 FROM public_works w WHERE w.id=c.work_id);

DROP TRIGGER comments_require_public_reply_insert;
CREATE TRIGGER comments_require_published_reply_insert
BEFORE INSERT ON comments
WHEN NEW.root_comment_id IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM published_comments root WHERE root.id=NEW.root_comment_id)
  OR (NEW.reply_to_comment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM published_comments target WHERE target.id=NEW.reply_to_comment_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'comment reply target unavailable');
END;

-- Public counts include both public and members' works, never maintainer-only works.
-- public_works remains unchanged for feeds, profiles, sitemaps and published assets.
DROP VIEW public_user_work_tags;
CREATE VIEW public_user_work_tags AS
SELECT t.work_id,t.user_id,t.name,t.sort_order,t.created_at
FROM user_work_tags t
JOIN user_work_entries e ON e.work_id=t.work_id AND e.user_id=t.user_id
JOIN users u ON u.id=t.user_id
WHERE e.favorited_at IS NOT NULL AND u.status='active'
  AND EXISTS(SELECT 1 FROM member_works WHERE id=t.work_id);

DROP TRIGGER work_tags_count_insert;
CREATE TRIGGER work_tags_count_insert AFTER INSERT ON work_tags
BEGIN
  INSERT INTO counted_public_tags(work_id,name)
    SELECT NEW.work_id,NEW.tag_name WHERE EXISTS(SELECT 1 FROM member_works WHERE id=NEW.work_id)
    ON CONFLICT DO NOTHING;
END;

DROP TRIGGER work_tags_count_update;
CREATE TRIGGER work_tags_count_update AFTER UPDATE OF work_id,tag_name ON work_tags
WHEN OLD.work_id IS NOT NEW.work_id OR OLD.tag_name IS NOT NEW.tag_name COLLATE BINARY
BEGIN
  DELETE FROM counted_public_tags WHERE work_id=NEW.work_id AND name=NEW.tag_name
    AND NOT EXISTS(SELECT 1 FROM member_works WHERE id=NEW.work_id);
  INSERT INTO counted_public_tags(work_id,name)
    SELECT NEW.work_id,NEW.tag_name WHERE EXISTS(SELECT 1 FROM member_works WHERE id=NEW.work_id)
    ON CONFLICT DO NOTHING;
END;

DROP TRIGGER works_tag_counts_visibility;
CREATE TRIGGER works_tag_counts_visibility AFTER UPDATE OF status,audience ON works
WHEN OLD.status IS NOT NEW.status OR OLD.audience IS NOT NEW.audience
BEGIN
  DELETE FROM counted_public_tags WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM member_works WHERE id=NEW.id);
  DELETE FROM counted_user_tags WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM member_works WHERE id=NEW.id);
  INSERT INTO counted_public_tags(work_id,name)
    SELECT work_id,tag_name FROM work_tags WHERE work_id=NEW.id
      AND EXISTS(SELECT 1 FROM member_works WHERE id=NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id,user_id,name)
    SELECT work_id,user_id,name FROM public_user_work_tags WHERE work_id=NEW.id ON CONFLICT DO NOTHING;
END;

DROP TRIGGER works_genre_insert;
CREATE TRIGGER works_genre_insert AFTER INSERT ON works
BEGIN
  INSERT INTO work_genres(name)
    SELECT NEW.genre WHERE NEW.genre IS NOT NULL AND NEW.genre<>''
      AND NOT EXISTS(SELECT 1 FROM work_genres WHERE name=NEW.genre);
  UPDATE works SET genre_group_id=(SELECT group_id FROM work_genres WHERE name=NEW.genre) WHERE id=NEW.id;
  DELETE FROM counted_work_genres WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM member_works w WHERE w.id=NEW.id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
    SELECT id,genre FROM member_works WHERE id=NEW.id AND genre IS NOT NULL AND genre<>''
    ON CONFLICT(work_id) DO NOTHING;
END;

DROP TRIGGER works_genre_update;
CREATE TRIGGER works_genre_update AFTER UPDATE OF genre,status,audience ON works
WHEN OLD.genre IS NOT NEW.genre OR OLD.status IS NOT NEW.status OR OLD.audience IS NOT NEW.audience
BEGIN
  INSERT INTO work_genres(name)
    SELECT NEW.genre WHERE NEW.genre IS NOT NULL AND NEW.genre<>''
      AND NOT EXISTS(SELECT 1 FROM work_genres WHERE name=NEW.genre);
  UPDATE works SET genre_group_id=(SELECT group_id FROM work_genres WHERE name=NEW.genre) WHERE id=NEW.id;
  DELETE FROM counted_work_genres WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM member_works w WHERE w.id=NEW.id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
    SELECT id,genre FROM member_works WHERE id=NEW.id AND genre IS NOT NULL AND genre<>''
    ON CONFLICT(work_id) DO NOTHING;
END;

-- Backfill existing members' works through the same count-maintenance triggers.
INSERT INTO counted_public_tags(work_id,name)
  SELECT t.work_id,t.tag_name FROM work_tags t JOIN member_works w ON w.id=t.work_id
  WHERE w.audience='members' ON CONFLICT DO NOTHING;
INSERT INTO counted_user_tags(work_id,user_id,name)
  SELECT t.work_id,t.user_id,t.name FROM public_user_work_tags t JOIN member_works w ON w.id=t.work_id
  WHERE w.audience='members' ON CONFLICT DO NOTHING;
INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM member_works WHERE audience='members' AND genre IS NOT NULL AND genre<>''
  ON CONFLICT(work_id) DO NOTHING;
