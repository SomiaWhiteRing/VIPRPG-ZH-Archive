-- Consolidated unpublished migrations, preserving their original execution order.

-- 0006_public_tags_by_name.sql
-- Public tag names are their identity; preserve metadata and every work relation.
CREATE TABLE tags_by_name (
  name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
  namespace TEXT NOT NULL CHECK (
    namespace IN ('genre', 'theme', 'character', 'technical', 'content', 'other')
  ) DEFAULT 'other',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

INSERT INTO tags_by_name(name, namespace, description, created_at, updated_at)
SELECT name, namespace, description, created_at, updated_at FROM tags;

CREATE TABLE work_tags_by_name (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL COLLATE NOCASE REFERENCES tags_by_name(name) ON UPDATE CASCADE ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('admin', 'uploader', 'imported')) DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (work_id, tag_name)
) WITHOUT ROWID;

INSERT INTO work_tags_by_name(work_id, tag_name, source, created_at, sort_order)
SELECT wt.work_id, t.name, wt.source, wt.created_at, wt.sort_order
FROM work_tags wt JOIN tags t ON t.id = wt.tag_id;

DROP TABLE work_tags;
DROP TABLE tags;
ALTER TABLE tags_by_name RENAME TO tags;
ALTER TABLE work_tags_by_name RENAME TO work_tags;
CREATE INDEX idx_work_tags_name ON work_tags(tag_name, work_id);

-- 0007_user_work_tags.sql
CREATE TABLE user_work_tags (
  work_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, user_id, name),
  FOREIGN KEY (work_id, user_id) REFERENCES user_work_entries(work_id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
) WITHOUT ROWID;

CREATE INDEX idx_user_work_tags_name ON user_work_tags(name, work_id, user_id);
CREATE INDEX idx_user_work_tags_user ON user_work_tags(user_id, name, work_id);

CREATE TRIGGER user_work_tags_require_favorite_insert
BEFORE INSERT ON user_work_tags
WHEN NOT EXISTS (
  SELECT 1 FROM user_work_entries
  WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND favorited_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'user tags require a favorite');
END;

CREATE TRIGGER user_work_tags_require_favorite_update
BEFORE UPDATE OF work_id, user_id ON user_work_tags
WHEN NOT EXISTS (
  SELECT 1 FROM user_work_entries
  WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND favorited_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'user tags require a favorite');
END;

CREATE TRIGGER user_work_tags_remove_unfavorited
AFTER UPDATE OF favorited_at ON user_work_entries
WHEN NEW.favorited_at IS NULL
BEGIN
  DELETE FROM user_work_tags WHERE work_id=NEW.work_id AND user_id=NEW.user_id;
END;

CREATE VIEW public_user_work_tags AS
SELECT t.work_id,t.user_id,t.name,t.sort_order,t.created_at
FROM user_work_tags t
JOIN user_work_entries e ON e.work_id=t.work_id AND e.user_id=t.user_id
JOIN users u ON u.id=t.user_id
WHERE e.favorited_at IS NOT NULL AND u.status='active' AND u.profile_show_favorites=1
  AND t.work_id IN (SELECT id FROM public_works);

-- 0008_tag_usage_statistics.sql
-- Public tag statistics count associations, not distinct works across contributors.
-- Counted associations record exactly which rows contributed, so cascades and
-- visibility changes can subtract once even after their parent is no longer public.
-- Aggregated tagging is anonymous and independent of favorites-list privacy.
DROP VIEW public_user_work_tags;
CREATE VIEW public_user_work_tags AS
SELECT t.work_id,t.user_id,t.name,t.sort_order,t.created_at
FROM user_work_tags t
JOIN user_work_entries e ON e.work_id=t.work_id AND e.user_id=t.user_id
JOIN users u ON u.id=t.user_id
WHERE e.favorited_at IS NOT NULL AND u.status='active'
  AND EXISTS(SELECT 1 FROM public_works WHERE id=t.work_id);

CREATE TABLE tag_usage_stats (
  name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
  public_count INTEGER NOT NULL DEFAULT 0 CHECK (public_count >= 0),
  user_count INTEGER NOT NULL DEFAULT 0 CHECK (user_count >= 0)
) WITHOUT ROWID;

CREATE INDEX idx_tag_usage_stats_popular
  ON tag_usage_stats((public_count > 0) DESC, (public_count + user_count) DESC, name);

CREATE TABLE counted_public_tags (
  work_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (work_id, name),
  FOREIGN KEY (work_id, name) REFERENCES work_tags(work_id, tag_name)
    ON DELETE CASCADE ON UPDATE CASCADE
) WITHOUT ROWID;

CREATE TABLE counted_user_tags (
  work_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (work_id, user_id, name),
  FOREIGN KEY (work_id, user_id, name) REFERENCES user_work_tags(work_id, user_id, name)
    ON DELETE CASCADE ON UPDATE CASCADE
) WITHOUT ROWID;

CREATE INDEX idx_counted_user_tags_user ON counted_user_tags(user_id, work_id, name);
CREATE INDEX idx_counted_user_tags_name ON counted_user_tags(name, work_id);

CREATE TRIGGER counted_public_tags_insert
AFTER INSERT ON counted_public_tags
BEGIN
  INSERT INTO tag_usage_stats(name, public_count) VALUES(NEW.name, 1)
  ON CONFLICT(name) DO UPDATE SET public_count=public_count+1;
END;

CREATE TRIGGER counted_public_tags_delete
AFTER DELETE ON counted_public_tags
BEGIN
  UPDATE tag_usage_stats SET public_count=public_count-1 WHERE name=OLD.name;
  DELETE FROM tag_usage_stats WHERE name=OLD.name AND public_count=0 AND user_count=0;
END;

CREATE TRIGGER counted_public_tags_rename
AFTER UPDATE OF name ON counted_public_tags
WHEN OLD.name <> NEW.name COLLATE NOCASE
BEGIN
  UPDATE tag_usage_stats SET public_count=public_count-1 WHERE name=OLD.name;
  DELETE FROM tag_usage_stats WHERE name=OLD.name AND public_count=0 AND user_count=0;
  INSERT INTO tag_usage_stats(name, public_count) VALUES(NEW.name, 1)
  ON CONFLICT(name) DO UPDATE SET public_count=public_count+1;
END;

CREATE TRIGGER counted_user_tags_insert
AFTER INSERT ON counted_user_tags
BEGIN
  INSERT INTO tag_usage_stats(name, user_count) VALUES(NEW.name, 1)
  ON CONFLICT(name) DO UPDATE SET user_count=user_count+1;
END;

CREATE TRIGGER counted_user_tags_delete
AFTER DELETE ON counted_user_tags
BEGIN
  UPDATE tag_usage_stats SET user_count=user_count-1 WHERE name=OLD.name;
  DELETE FROM tag_usage_stats WHERE name=OLD.name AND user_count=0 AND public_count=0;
END;

CREATE TRIGGER counted_user_tags_rename
AFTER UPDATE OF name ON counted_user_tags
WHEN OLD.name <> NEW.name COLLATE NOCASE
BEGIN
  UPDATE tag_usage_stats SET user_count=user_count-1 WHERE name=OLD.name;
  DELETE FROM tag_usage_stats WHERE name=OLD.name AND user_count=0 AND public_count=0;
  INSERT INTO tag_usage_stats(name, user_count) VALUES(NEW.name, 1)
  ON CONFLICT(name) DO UPDATE SET user_count=user_count+1;
END;

-- Ordinary tagging touches only its own association and the name's counter.

CREATE TRIGGER work_tags_count_insert
AFTER INSERT ON work_tags
BEGIN
  INSERT INTO counted_public_tags(work_id, name)
  SELECT NEW.work_id, NEW.tag_name WHERE EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER work_tags_count_update
AFTER UPDATE OF work_id, tag_name ON work_tags
WHEN OLD.work_id IS NOT NEW.work_id OR OLD.tag_name IS NOT NEW.tag_name COLLATE BINARY
BEGIN
  DELETE FROM counted_public_tags WHERE work_id=NEW.work_id AND name=NEW.tag_name
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT NEW.work_id, NEW.tag_name WHERE EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER user_work_tags_count_insert
AFTER INSERT ON user_work_tags
BEGIN
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags
  WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND name=NEW.name
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER user_work_tags_count_update
AFTER UPDATE OF work_id, user_id, name ON user_work_tags
WHEN OLD.work_id IS NOT NEW.work_id OR OLD.user_id IS NOT NEW.user_id OR OLD.name IS NOT NEW.name COLLATE BINARY
BEGIN
  DELETE FROM counted_user_tags WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND name=NEW.name
    AND NOT EXISTS(SELECT 1 FROM public_user_work_tags
      WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND name=NEW.name);
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags
  WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND name=NEW.name
  ON CONFLICT DO NOTHING;
END;

-- Unfavoriting deletes user_work_tags through the existing trigger; deleting a
-- favorite, account, work or public tag cascades through these counted relations.
-- Only this user's associations need reconsidering when account status changes.

CREATE TRIGGER users_tag_counts_visibility
AFTER UPDATE OF status ON users
WHEN OLD.status IS NOT NEW.status
BEGIN
  DELETE FROM counted_user_tags WHERE user_id=NEW.id
    AND NEW.status <> 'active';
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE user_id=NEW.id
  ON CONFLICT DO NOTHING;
END;

-- Reconcile only the affected work(s), using the authoritative public_works view.
-- No global recount runs on requests or ordinary tagging. Download availability
-- depends on works, current archives and download_page links; keep these in sync
-- if the public_works definition gains another visibility dependency.

CREATE TRIGGER works_tag_counts_visibility
AFTER UPDATE OF status, engine_family ON works
WHEN OLD.status IS NOT NEW.status OR OLD.engine_family IS NOT NEW.engine_family
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (NEW.id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (NEW.id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (NEW.id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (NEW.id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER archive_tag_counts_insert
AFTER INSERT ON archive_versions
WHEN NEW.status='published' AND NEW.is_current=1
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (NEW.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER archive_tag_counts_delete
AFTER DELETE ON archive_versions
WHEN OLD.status='published' AND OLD.is_current=1
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (OLD.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (OLD.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER archive_tag_counts_update
AFTER UPDATE OF work_id, status, is_current, purged_at ON archive_versions
WHEN (OLD.work_id IS NOT NEW.work_id OR OLD.status IS NOT NEW.status OR OLD.is_current IS NOT NEW.is_current OR OLD.purged_at IS NOT NEW.purged_at)
  AND ((OLD.status='published' AND OLD.is_current=1) OR (NEW.status='published' AND NEW.is_current=1))
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER download_link_tag_counts_insert
AFTER INSERT ON work_external_links
WHEN NEW.link_type='download_page'
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (NEW.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER download_link_tag_counts_delete
AFTER DELETE ON work_external_links
WHEN OLD.link_type='download_page'
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (OLD.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (OLD.work_id)
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER download_link_tag_counts_update
AFTER UPDATE OF work_id, link_type ON work_external_links
WHEN (OLD.work_id IS NOT NEW.work_id OR OLD.link_type IS NOT NEW.link_type)
  AND (OLD.link_type='download_page' OR NEW.link_type='download_page')
BEGIN
  DELETE FROM counted_public_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_public_tags.work_id);
  DELETE FROM counted_user_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=counted_user_tags.work_id);
  INSERT INTO counted_public_tags(work_id, name)
  SELECT work_id, tag_name FROM work_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND EXISTS(SELECT 1 FROM public_works WHERE id=work_tags.work_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id, user_id, name)
  SELECT work_id, user_id, name FROM public_user_work_tags WHERE work_id IN (OLD.work_id, NEW.work_id)
  ON CONFLICT DO NOTHING;
END;

-- One-time backfill. The counter triggers also run for each existing association.
INSERT INTO counted_public_tags(work_id, name)
SELECT wt.work_id, wt.tag_name FROM work_tags wt
WHERE EXISTS(SELECT 1 FROM public_works WHERE id=wt.work_id);

INSERT INTO counted_user_tags(work_id, user_id, name)
SELECT work_id, user_id, name FROM public_user_work_tags;

-- 0009_tag_usage_sort.sql
-- Browse merged tags by total usage, without prioritizing public tags.
DROP INDEX idx_tag_usage_stats_popular;
CREATE INDEX idx_tag_usage_stats_popular
  ON tag_usage_stats((public_count + user_count) DESC, name);

-- 0010_favorite_notes.sql
ALTER TABLE user_work_entries
ADD COLUMN favorite_note TEXT NOT NULL DEFAULT ''
  CHECK (length(favorite_note) <= 380 AND instr(favorite_note, char(0)) = 0
    AND (favorited_at IS NOT NULL OR favorite_note = ''));

-- 0011_favorite_limits.sql
-- Replace only the note column's CHECK, preserving entries, timestamps and tags.
ALTER TABLE user_work_entries
ADD COLUMN favorite_note_next TEXT NOT NULL DEFAULT ''
  CHECK (length(favorite_note_next) <= 500 AND instr(favorite_note_next, char(0)) = 0
    AND (favorited_at IS NOT NULL OR favorite_note_next = ''));

UPDATE user_work_entries SET favorite_note_next = favorite_note;
ALTER TABLE user_work_entries DROP COLUMN favorite_note;
ALTER TABLE user_work_entries RENAME COLUMN favorite_note_next TO favorite_note;

-- Preserve existing tags; enforce the smaller limits on new associations.
-- Existing keys are exempt so upserts and INSERT OR IGNORE remain idempotent.
CREATE TRIGGER user_work_tags_limits_insert
BEFORE INSERT ON user_work_tags
WHEN NOT EXISTS (
  SELECT 1 FROM user_work_tags
  WHERE work_id=NEW.work_id AND user_id=NEW.user_id AND name=NEW.name
)
BEGIN
  SELECT CASE WHEN length(NEW.name)>20 OR instr(NEW.name,char(0))>0
    THEN RAISE(ABORT, 'user tags must be at most 20 characters') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM user_work_tags WHERE work_id=NEW.work_id AND user_id=NEW.user_id
  )>=10 THEN RAISE(ABORT, 'favorites allow at most 10 tags') END;
END;

CREATE TRIGGER user_work_tags_limits_update
BEFORE UPDATE OF work_id,user_id,name ON user_work_tags
WHEN OLD.work_id IS NOT NEW.work_id OR OLD.user_id IS NOT NEW.user_id
  OR OLD.name IS NOT NEW.name COLLATE BINARY
BEGIN
  SELECT CASE WHEN length(NEW.name)>20 OR instr(NEW.name,char(0))>0
    THEN RAISE(ABORT, 'user tags must be at most 20 characters') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM user_work_tags
    WHERE work_id=NEW.work_id AND user_id=NEW.user_id
      AND NOT (work_id=OLD.work_id AND user_id=OLD.user_id AND name=OLD.name)
  )>=10 THEN RAISE(ABORT, 'favorites allow at most 10 tags') END;
END;

-- 0012_favorite_query_indexes.sql
-- Public availability checks only need links belonging to the target work.
CREATE INDEX idx_work_external_links_work_type
  ON work_external_links(work_id, link_type);

-- Keep the user-first index for personal libraries; this serves a work's collectors.
CREATE INDEX idx_user_work_entries_work_favorites
  ON user_work_entries(work_id, favorited_at DESC, user_id DESC)
  WHERE favorited_at IS NOT NULL;

-- 0013_bounded_read_indexes.sql
-- Reverse lookups must not scan the entire referencing table for each object.
CREATE INDEX idx_work_staff_creator_work ON work_staff(creator_id, work_id);
CREATE INDEX idx_comments_work_public ON comments(work_id)
  WHERE work_id IS NOT NULL AND status = 'published';
CREATE INDEX idx_comments_creator_public ON comments(creator_id)
  WHERE creator_id IS NOT NULL AND status = 'published';
CREATE INDEX idx_users_avatar_blob ON users(avatar_blob_sha256)
  WHERE avatar_blob_sha256 IS NOT NULL;
CREATE INDEX idx_creators_avatar_blob ON creators(avatar_blob_sha256)
  WHERE avatar_blob_sha256 IS NOT NULL;
CREATE INDEX idx_resources_icon_blob ON resources(icon_blob_sha256)
  WHERE icon_blob_sha256 IS NOT NULL;
CREATE INDEX idx_archive_versions_live_manifest ON archive_versions(manifest_sha256)
  WHERE purged_at IS NULL;

-- Page through active objects before checking age or references: even a page of
-- young or retained objects has a fixed inspection budget.
CREATE INDEX idx_blobs_gc_scan ON blobs(sha256)
  WHERE status IN ('active', 'purging');
CREATE INDEX idx_core_packs_gc_scan ON core_packs(sha256)
  WHERE status IN ('active', 'purging');
CREATE TABLE archive_gc_cursors (
  object_type TEXT PRIMARY KEY CHECK(object_type IN ('blob', 'core_pack')),
  sha256 TEXT NOT NULL
);
