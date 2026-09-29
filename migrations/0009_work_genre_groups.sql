-- Preserve each spelling; materialize filter groups and public suggestion counts on writes.
CREATE TABLE work_genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE BINARY UNIQUE CHECK (length(name) > 0),
  group_id INTEGER NOT NULL DEFAULT 0,
  public_count INTEGER NOT NULL DEFAULT 0 CHECK (public_count >= 0)
);
CREATE INDEX idx_work_genres_group ON work_genres(group_id);
CREATE INDEX idx_work_genres_public_name ON work_genres(name COLLATE NOCASE)
  WHERE public_count > 0;

CREATE TRIGGER work_genres_identity AFTER INSERT ON work_genres
WHEN NEW.group_id = 0
BEGIN
  UPDATE work_genres SET group_id=NEW.id WHERE id=NEW.id;
END;

ALTER TABLE works ADD COLUMN genre_group_id INTEGER;
CREATE INDEX idx_works_genre ON works(genre);
CREATE INDEX idx_works_genre_group ON works(genre_group_id, id DESC);

-- Group changes propagate without changing any work's spelling or updated_at.
CREATE TRIGGER work_genres_merge AFTER UPDATE OF group_id ON work_genres
WHEN OLD.group_id IS NOT NEW.group_id
BEGIN
  UPDATE works SET genre_group_id=NEW.group_id WHERE genre=NEW.name;
END;

INSERT INTO work_genres(name)
SELECT DISTINCT genre FROM works WHERE genre IS NOT NULL AND genre <> '';
UPDATE works SET genre_group_id=(SELECT group_id FROM work_genres WHERE name=works.genre);

CREATE TABLE counted_work_genres (
  work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  name TEXT NOT NULL REFERENCES work_genres(name)
);
CREATE TRIGGER counted_work_genres_insert AFTER INSERT ON counted_work_genres
BEGIN
  UPDATE work_genres SET public_count=public_count+1 WHERE name=NEW.name;
END;
CREATE TRIGGER counted_work_genres_delete AFTER DELETE ON counted_work_genres
BEGIN
  UPDATE work_genres SET public_count=public_count-1 WHERE name=OLD.name;
END;

-- Reconcile only affected works. public_works is the authoritative visibility rule.
-- Keep these dependencies aligned with that view: status/engine, archives, download links.
CREATE TRIGGER works_genre_insert AFTER INSERT ON works
BEGIN
  INSERT INTO work_genres(name)
  SELECT NEW.genre WHERE NEW.genre IS NOT NULL AND NEW.genre <> ''
    AND NOT EXISTS (SELECT 1 FROM work_genres WHERE name=NEW.genre);
  UPDATE works SET genre_group_id=(SELECT group_id FROM work_genres WHERE name=NEW.genre)
    WHERE id=NEW.id;
  DELETE FROM counted_work_genres WHERE work_id IN (NEW.id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (NEW.id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;
CREATE TRIGGER works_genre_update AFTER UPDATE OF genre, status, engine_family ON works
WHEN OLD.genre IS NOT NEW.genre OR OLD.status IS NOT NEW.status OR OLD.engine_family IS NOT NEW.engine_family
BEGIN
  INSERT INTO work_genres(name)
  SELECT NEW.genre WHERE NEW.genre IS NOT NULL AND NEW.genre <> ''
    AND NOT EXISTS (SELECT 1 FROM work_genres WHERE name=NEW.genre);
  UPDATE works SET genre_group_id=(SELECT group_id FROM work_genres WHERE name=NEW.genre)
    WHERE id=NEW.id;
  DELETE FROM counted_work_genres WHERE work_id IN (NEW.id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (NEW.id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER archive_genre_insert AFTER INSERT ON archive_versions
WHEN NEW.status='published' AND NEW.is_current=1
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (NEW.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER archive_genre_delete AFTER DELETE ON archive_versions
WHEN OLD.status='published' AND OLD.is_current=1
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (OLD.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER archive_genre_update AFTER UPDATE OF work_id, status, is_current, purged_at ON archive_versions
WHEN (OLD.work_id IS NOT NEW.work_id OR OLD.status IS NOT NEW.status OR OLD.is_current IS NOT NEW.is_current OR OLD.purged_at IS NOT NEW.purged_at) AND ((OLD.status='published' AND OLD.is_current=1) OR (NEW.status='published' AND NEW.is_current=1))
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (OLD.work_id, NEW.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER download_link_genre_insert AFTER INSERT ON work_external_links
WHEN NEW.link_type='download_page'
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (NEW.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (NEW.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER download_link_genre_delete AFTER DELETE ON work_external_links
WHEN OLD.link_type='download_page'
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (OLD.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (OLD.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

CREATE TRIGGER download_link_genre_update AFTER UPDATE OF work_id, link_type ON work_external_links
WHEN (OLD.work_id IS NOT NEW.work_id OR OLD.link_type IS NOT NEW.link_type) AND (OLD.link_type='download_page' OR NEW.link_type='download_page')
BEGIN
  DELETE FROM counted_work_genres WHERE work_id IN (OLD.work_id, NEW.work_id)
    AND NOT EXISTS (SELECT 1 FROM public_works w
      WHERE w.id=counted_work_genres.work_id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
  SELECT id,genre FROM public_works WHERE id IN (OLD.work_id, NEW.work_id) AND genre IS NOT NULL AND genre <> ''
  ON CONFLICT(work_id) DO NOTHING;
END;

INSERT INTO counted_work_genres(work_id,name)
SELECT id,genre FROM public_works WHERE genre IS NOT NULL AND genre <> '';

-- Only built-in administrator roles receive global genre-group maintenance by default.
INSERT OR IGNORE INTO role_permissions(role_id,permission_key)
SELECT id,'genre.manage' FROM roles WHERE key IN ('admin','super_admin');
