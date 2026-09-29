-- Work publication controls discovery; download availability is independent.
-- Public media/creator qualification is durable, not recomputed from live references.
-- An unreferenced public blob is still collectible under the existing GC policy.
ALTER TABLE blobs ADD COLUMN public_at TEXT;
ALTER TABLE creators ADD COLUMN public_at TEXT;
CREATE INDEX idx_creators_public_name ON creators(name COLLATE NOCASE,id) WHERE public_at IS NOT NULL;

-- Backfill only currently provable publication, never infer from work.published_at:
-- a private image or credit may have been added after a work was hidden.
UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE sha256 IN (SELECT b.sha256
        FROM blobs b
        WHERE 1=1
          AND b.status = 'active'
          AND (
            EXISTS (
              SELECT 1 FROM resources r
              WHERE r.icon_blob_sha256 = b.sha256 AND r.visibility = 'published'
            )
            OR
            EXISTS (
              SELECT 1
              FROM media_assets ma
              JOIN work_media_assets wma ON wma.media_asset_id = ma.id
              JOIN works w ON w.id = wma.work_id
              WHERE ma.blob_sha256 = b.sha256
                AND w.id IN (SELECT id FROM public_works)
            )
            OR EXISTS (
              SELECT 1
              FROM users u
              WHERE u.avatar_blob_sha256 = b.sha256
                AND u.status = 'active'
            )
            OR EXISTS (
              SELECT 1
              FROM creators c
              WHERE c.avatar_blob_sha256 = b.sha256
                AND EXISTS (
                  SELECT 1 FROM work_staff ws
                  JOIN works w ON w.id=ws.work_id
                  WHERE ws.creator_id=c.id AND w.id IN (SELECT id FROM public_works)
                )
            )
            OR EXISTS (
              SELECT 1
              FROM catalogs c
              WHERE c.cover_blob_sha256 = b.sha256
                AND c.status = 'published'
            )
            OR EXISTS (
              SELECT 1 FROM character_materials m
              JOIN character_material_bindings binding ON binding.material_id=m.id
              WHERE m.blob_sha256=b.sha256
            )
            OR EXISTS (
              SELECT 1
              FROM face_sheets fs
              WHERE fs.blob_sha256 = b.sha256
                AND (
                  fs.library_status = 'approved'
                  OR EXISTS (
                    SELECT 1
                    FROM character_portrait_refs cpr
                    JOIN work_characters wc ON wc.portrait_ref_id = cpr.id
                    JOIN works w ON w.id = wc.work_id
                    WHERE cpr.face_sheet_id = fs.id
                      AND w.id IN (SELECT id FROM public_works)
                  )
                )
            )
          )
        );
UPDATE creators SET public_at=CURRENT_TIMESTAMP WHERE EXISTS (
  SELECT 1 FROM work_staff s JOIN public_works w ON w.id=s.work_id WHERE s.creator_id=creators.id
);

DROP VIEW public_works;
CREATE VIEW public_works AS SELECT * FROM works WHERE status='published';
DROP VIEW public_comments;
CREATE VIEW public_comments AS
SELECT c.* FROM comments c
JOIN users u ON u.id=c.user_id
JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
JOIN users root_user ON root_user.id=root.user_id
WHERE c.status='published' AND root.status='published'
  AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
  AND (EXISTS (SELECT 1 FROM public_works w WHERE w.id=c.work_id)
    OR EXISTS (SELECT 1 FROM creators cr WHERE cr.id=c.creator_id AND cr.public_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM characters ch WHERE ch.id=c.character_id));


DROP TRIGGER archive_tag_counts_insert;

DROP TRIGGER archive_tag_counts_delete;

DROP TRIGGER archive_tag_counts_update;

DROP TRIGGER download_link_tag_counts_insert;

DROP TRIGGER download_link_tag_counts_delete;

DROP TRIGGER download_link_tag_counts_update;

DROP TRIGGER archive_genre_insert;

DROP TRIGGER archive_genre_delete;

DROP TRIGGER archive_genre_update;

DROP TRIGGER download_link_genre_insert;

DROP TRIGGER download_link_genre_delete;

DROP TRIGGER download_link_genre_update;

DROP TRIGGER works_tag_counts_visibility;
CREATE TRIGGER works_tag_counts_visibility
AFTER UPDATE OF status ON works
WHEN OLD.status IS NOT NEW.status
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

DROP TRIGGER works_genre_update;
CREATE TRIGGER works_genre_update AFTER UPDATE OF genre, status ON works
WHEN OLD.genre IS NOT NEW.genre OR OLD.status IS NOT NEW.status
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

-- Newly visible missing-source works enter the existing incremental counters.
INSERT OR IGNORE INTO counted_public_tags(work_id,name)
SELECT work_id,tag_name FROM work_tags WHERE work_id IN (SELECT id FROM public_works);
INSERT OR IGNORE INTO counted_user_tags(work_id,user_id,name)
SELECT work_id,user_id,name FROM public_user_work_tags;
INSERT OR IGNORE INTO counted_work_genres(work_id,name)
SELECT id,genre FROM public_works WHERE genre IS NOT NULL AND genre<>'';

-- All eligibility writes share the publishing transaction. Hiding/removing a
-- reference never revokes already public bytes or a public creator identity.


CREATE TRIGGER works_publish_assets AFTER UPDATE OF status ON works
WHEN NEW.status='published' AND OLD.status IS NOT NEW.status
BEGIN
  UPDATE creators SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND id IN (SELECT creator_id FROM work_staff WHERE work_id=NEW.id);
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT ma.blob_sha256 FROM work_media_assets wm JOIN media_assets ma ON ma.id=wm.media_asset_id WHERE wm.work_id=NEW.id);
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT fs.blob_sha256 FROM work_characters wc JOIN character_portrait_refs ref ON ref.id=wc.portrait_ref_id JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE wc.work_id=NEW.id AND fs.library_status<>'rejected');
END;

CREATE TRIGGER work_staff_publish_creator_insert AFTER INSERT ON work_staff
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE creators SET public_at=CURRENT_TIMESTAMP WHERE id=NEW.creator_id AND public_at IS NULL;
END;

CREATE TRIGGER work_staff_publish_creator_update AFTER UPDATE OF work_id,creator_id ON work_staff
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE creators SET public_at=CURRENT_TIMESTAMP WHERE id=NEW.creator_id AND public_at IS NULL;
END;

CREATE TRIGGER work_media_publish_blob_insert AFTER INSERT ON work_media_assets
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT blob_sha256 FROM media_assets WHERE id=NEW.media_asset_id);
END;

CREATE TRIGGER work_media_publish_blob_update AFTER UPDATE OF work_id,media_asset_id ON work_media_assets
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT blob_sha256 FROM media_assets WHERE id=NEW.media_asset_id);
END;

CREATE TRIGGER media_assets_publish_blob AFTER UPDATE OF blob_sha256 ON media_assets
WHEN OLD.blob_sha256 IS NOT NEW.blob_sha256 AND EXISTS(SELECT 1 FROM work_media_assets wm JOIN public_works w ON w.id=wm.work_id WHERE wm.media_asset_id=NEW.id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.blob_sha256);
END;

CREATE TRIGGER work_portrait_publish_blob_insert AFTER INSERT ON work_characters
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT fs.blob_sha256 FROM character_portrait_refs ref JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE ref.id=NEW.portrait_ref_id AND fs.library_status<>'rejected');
END;

CREATE TRIGGER work_portrait_publish_blob_update AFTER UPDATE OF work_id,portrait_ref_id ON work_characters
WHEN EXISTS(SELECT 1 FROM public_works WHERE id=NEW.work_id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT fs.blob_sha256 FROM character_portrait_refs ref JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE ref.id=NEW.portrait_ref_id AND fs.library_status<>'rejected');
END;

CREATE TRIGGER portrait_ref_publish_blob AFTER UPDATE OF face_sheet_id ON character_portrait_refs
WHEN EXISTS(SELECT 1 FROM work_characters wc JOIN public_works w ON w.id=wc.work_id WHERE wc.portrait_ref_id=NEW.id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT blob_sha256 FROM face_sheets WHERE id=NEW.face_sheet_id AND library_status<>'rejected');
END;

CREATE TRIGGER creator_publish_avatar_insert AFTER INSERT ON creators
WHEN NEW.public_at IS NOT NULL
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.avatar_blob_sha256);
END;

CREATE TRIGGER creator_publish_avatar_update AFTER UPDATE OF public_at,avatar_blob_sha256 ON creators
WHEN NEW.public_at IS NOT NULL
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.avatar_blob_sha256);
END;

CREATE TRIGGER user_publish_avatar_insert AFTER INSERT ON users
WHEN NEW.status='active'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.avatar_blob_sha256);
END;

CREATE TRIGGER user_publish_avatar_update AFTER UPDATE OF status,avatar_blob_sha256 ON users
WHEN NEW.status='active'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.avatar_blob_sha256);
END;

CREATE TRIGGER resource_publish_icon_insert AFTER INSERT ON resources
WHEN NEW.visibility='published'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.icon_blob_sha256);
END;

CREATE TRIGGER resource_publish_icon_update AFTER UPDATE OF visibility,icon_blob_sha256 ON resources
WHEN NEW.visibility='published'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.icon_blob_sha256);
END;

CREATE TRIGGER catalog_publish_cover_insert AFTER INSERT ON catalogs
WHEN NEW.status='published'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.cover_blob_sha256);
END;

CREATE TRIGGER catalog_publish_cover_update AFTER UPDATE OF status,cover_blob_sha256 ON catalogs
WHEN NEW.status='published'
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.cover_blob_sha256);
END;

CREATE TRIGGER face_sheet_publish_blob_insert AFTER INSERT ON face_sheets
WHEN NEW.library_status='approved' OR (NEW.library_status<>'rejected' AND EXISTS(SELECT 1 FROM character_portrait_refs ref JOIN work_characters wc ON wc.portrait_ref_id=ref.id JOIN public_works w ON w.id=wc.work_id WHERE ref.face_sheet_id=NEW.id))
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.blob_sha256);
END;

CREATE TRIGGER face_sheet_publish_blob_update AFTER UPDATE OF library_status,blob_sha256 ON face_sheets
WHEN NEW.library_status='approved' OR (NEW.library_status<>'rejected' AND EXISTS(SELECT 1 FROM character_portrait_refs ref JOIN work_characters wc ON wc.portrait_ref_id=ref.id JOIN public_works w ON w.id=wc.work_id WHERE ref.face_sheet_id=NEW.id))
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.blob_sha256);
END;

CREATE TRIGGER material_binding_publish_blob_insert AFTER INSERT ON character_material_bindings
WHEN 1=1
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT blob_sha256 FROM character_materials WHERE id=NEW.material_id);
END;

CREATE TRIGGER material_binding_publish_blob_update AFTER UPDATE OF material_id ON character_material_bindings
WHEN 1=1
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT blob_sha256 FROM character_materials WHERE id=NEW.material_id);
END;

CREATE TRIGGER material_publish_blob AFTER UPDATE OF blob_sha256 ON character_materials
WHEN EXISTS(SELECT 1 FROM character_material_bindings WHERE material_id=NEW.id)
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP
  WHERE public_at IS NULL AND sha256 IN (SELECT NEW.blob_sha256);
END;

-- Qualify currently published works newly admitted by the simpler view.
UPDATE creators SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL AND EXISTS (
  SELECT 1 FROM work_staff s JOIN public_works w ON w.id=s.work_id WHERE s.creator_id=creators.id
);
UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL AND sha256 IN (
  SELECT ma.blob_sha256 FROM work_media_assets wm JOIN media_assets ma ON ma.id=wm.media_asset_id JOIN public_works w ON w.id=wm.work_id
  UNION SELECT fs.blob_sha256 FROM work_characters wc JOIN public_works w ON w.id=wc.work_id
    JOIN character_portrait_refs ref ON ref.id=wc.portrait_ref_id JOIN face_sheets fs ON fs.id=ref.face_sheet_id WHERE fs.library_status<>'rejected'
);
