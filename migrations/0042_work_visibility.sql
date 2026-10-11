-- Access scope and homepage discovery are independent of publication lifecycle.
ALTER TABLE works ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK(audience IN ('public','members','maintainers'));
ALTER TABLE works ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 1 CHECK(show_on_home IN (0,1));

-- Preserve the existing hidden-work boundary and non-VIPRPG homepage exclusion.
UPDATE works SET audience='maintainers',show_on_home=0 WHERE status='hidden';
UPDATE works SET show_on_home=0 WHERE id IN (SELECT work_id FROM work_tags WHERE tag_name='非VIPRPG' COLLATE NOCASE);

DROP VIEW public_works;
CREATE VIEW public_works AS SELECT * FROM works WHERE status='published' AND audience='public';
CREATE VIEW member_works AS SELECT * FROM works WHERE status='published' AND audience IN ('public','members');
CREATE INDEX works_audience_home ON works(status,audience,show_on_home,id DESC);

CREATE TRIGGER work_non_viprpg_home_insert AFTER INSERT ON work_tags
WHEN NEW.tag_name='非VIPRPG' COLLATE NOCASE
BEGIN
  UPDATE works SET show_on_home=0 WHERE id=NEW.work_id AND show_on_home<>0;
END;
CREATE TRIGGER work_non_viprpg_home_update AFTER UPDATE OF work_id,tag_name ON work_tags
WHEN NEW.tag_name='非VIPRPG' COLLATE NOCASE
BEGIN
  UPDATE works SET show_on_home=0 WHERE id=NEW.work_id AND show_on_home<>0;
END;

DROP TRIGGER works_tag_counts_visibility;
CREATE TRIGGER works_tag_counts_visibility AFTER UPDATE OF status,audience ON works
WHEN OLD.status IS NOT NEW.status OR OLD.audience IS NOT NEW.audience
BEGIN
  DELETE FROM counted_public_tags WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=NEW.id);
  DELETE FROM counted_user_tags WHERE work_id=NEW.id
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=NEW.id);
  INSERT INTO counted_public_tags(work_id,name)
    SELECT work_id,tag_name FROM work_tags WHERE work_id=NEW.id
      AND EXISTS(SELECT 1 FROM public_works WHERE id=NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO counted_user_tags(work_id,user_id,name)
    SELECT work_id,user_id,name FROM public_user_work_tags WHERE work_id=NEW.id ON CONFLICT DO NOTHING;
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
    AND NOT EXISTS(SELECT 1 FROM public_works w WHERE w.id=NEW.id AND w.genre=counted_work_genres.name);
  INSERT INTO counted_work_genres(work_id,name)
    SELECT id,genre FROM public_works WHERE id=NEW.id AND genre IS NOT NULL AND genre<>''
    ON CONFLICT(work_id) DO NOTHING;
END;

-- Never publish newly restricted media or creator identities. Already-public
-- identities and content-addressed bytes retain their established public URLs.
DROP TRIGGER works_publish_assets;
CREATE TRIGGER works_publish_assets AFTER UPDATE OF status,audience ON works
WHEN NEW.status='published' AND NEW.audience='public'
  AND (OLD.status IS NOT NEW.status OR OLD.audience IS NOT NEW.audience)
BEGIN
  UPDATE creators SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL
    AND id IN (SELECT creator_id FROM work_staff WHERE work_id=NEW.id);
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL
    AND sha256 IN (SELECT ma.blob_sha256 FROM work_media_assets wm JOIN media_assets ma ON ma.id=wm.media_asset_id WHERE wm.work_id=NEW.id);
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL
    AND sha256 IN (SELECT fs.blob_sha256 FROM work_characters wc JOIN character_portrait_refs ref ON ref.id=wc.portrait_ref_id
      JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE wc.work_id=NEW.id AND fs.library_status<>'rejected');
END;

-- Convert legacy hidden works only after the access rules protect private assets.
UPDATE works SET audience='maintainers',show_on_home=0,status='published' WHERE status='hidden';

-- The frozen baseline CHECK remains historical; reject obsolete states on all new writes.
CREATE TRIGGER works_lifecycle_insert BEFORE INSERT ON works
WHEN NEW.status NOT IN ('processing','published','deleted')
BEGIN
  SELECT RAISE(ABORT, 'invalid work lifecycle status');
END;
CREATE TRIGGER works_lifecycle_update BEFORE UPDATE OF status ON works
WHEN NEW.status NOT IN ('processing','published','deleted')
BEGIN
  SELECT RAISE(ABORT, 'invalid work lifecycle status');
END;
