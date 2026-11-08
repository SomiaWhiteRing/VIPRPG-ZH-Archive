-- Removing a CHECK requires rebuilding the table. D1 still applies
-- CASCADE and SET NULL during DROP even with deferred foreign keys.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE migration_0053_sheets AS SELECT * FROM face_sheets;
CREATE TABLE migration_0053_sequence AS SELECT seq FROM sqlite_sequence WHERE name='face_sheets';
CREATE TABLE migration_0053_uploaders AS SELECT * FROM face_sheet_uploaders;
CREATE TABLE migration_0053_bindings AS SELECT * FROM character_face_sheet_bindings;
CREATE TABLE migration_0053_portraits AS SELECT * FROM character_portrait_refs;
CREATE TABLE migration_0053_defaults AS SELECT * FROM character_default_portraits;
CREATE TABLE migration_0053_work_portraits AS
  SELECT id,portrait_ref_id FROM work_characters WHERE portrait_ref_id IS NOT NULL;
CREATE TABLE migration_0053_showcase_portraits AS
  SELECT user_id,kind,portrait_ref_id FROM user_showcase_entries WHERE portrait_ref_id IS NOT NULL;

DROP TABLE face_sheets;
CREATE TABLE face_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL UNIQUE REFERENCES blobs(sha256),
  width_px INTEGER NOT NULL CHECK (width_px BETWEEN 48 AND 192 AND width_px % 48 = 0),
  height_px INTEGER NOT NULL CHECK (typeof(height_px) = 'integer' AND height_px >= 48 AND height_px % 48 = 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('atwiki', 'user_upload', 'admin_upload')),
  source_page_url TEXT,
  source_image_url TEXT,
  source_page_title TEXT,
  source_section_title TEXT,
  source_order INTEGER CHECK (
    source_order IS NULL OR
    (typeof(source_order) = 'integer' AND source_order BETWEEN 0 AND 9007199254740991)
  ),
  library_status TEXT NOT NULL CHECK (library_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO face_sheets SELECT * FROM migration_0053_sheets;
DELETE FROM sqlite_sequence WHERE name='face_sheets';
INSERT INTO sqlite_sequence(name,seq) SELECT 'face_sheets',seq FROM migration_0053_sequence;
INSERT INTO face_sheet_uploaders SELECT * FROM migration_0053_uploaders;
INSERT INTO character_face_sheet_bindings SELECT * FROM migration_0053_bindings;
INSERT INTO character_portrait_refs SELECT * FROM migration_0053_portraits;
INSERT INTO character_default_portraits SELECT * FROM migration_0053_defaults;
UPDATE work_characters AS wc SET portrait_ref_id=backup.portrait_ref_id
  FROM migration_0053_work_portraits AS backup WHERE backup.id=wc.id;
UPDATE user_showcase_entries AS e SET portrait_ref_id=backup.portrait_ref_id
  FROM migration_0053_showcase_portraits AS backup WHERE (backup.user_id,backup.kind)=(e.user_id,e.kind);

DROP TABLE migration_0053_sheets;
DROP TABLE migration_0053_sequence;
DROP TABLE migration_0053_uploaders;
DROP TABLE migration_0053_bindings;
DROP TABLE migration_0053_portraits;
DROP TABLE migration_0053_defaults;
DROP TABLE migration_0053_work_portraits;
DROP TABLE migration_0053_showcase_portraits;

CREATE INDEX idx_face_sheets_library ON face_sheets(library_status,source_order,id);
CREATE INDEX idx_face_sheets_library_order ON face_sheets(
  CASE library_status WHEN 'approved' THEN 0 ELSE 1 END,
  source_order IS NULL,source_order,id
) WHERE library_status!='rejected';

CREATE TRIGGER face_sheets_require_active_blob_insert
BEFORE INSERT ON face_sheets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256=NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'face sheet blob must be active');
END;
CREATE TRIGGER face_sheets_require_active_blob_update
BEFORE UPDATE OF blob_sha256 ON face_sheets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256=NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'face sheet blob must be active');
END;

CREATE TRIGGER face_sheet_publish_blob_insert AFTER INSERT ON face_sheets
WHEN NEW.library_status='approved' OR (NEW.library_status<>'rejected' AND EXISTS(
  SELECT 1 FROM character_portrait_refs ref JOIN work_characters wc ON wc.portrait_ref_id=ref.id
  JOIN public_works w ON w.id=wc.work_id WHERE ref.face_sheet_id=NEW.id))
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL AND sha256=NEW.blob_sha256;
END;
CREATE TRIGGER face_sheet_publish_blob_update AFTER UPDATE OF library_status,blob_sha256 ON face_sheets
WHEN NEW.library_status='approved' OR (NEW.library_status<>'rejected' AND EXISTS(
  SELECT 1 FROM character_portrait_refs ref JOIN work_characters wc ON wc.portrait_ref_id=ref.id
  JOIN public_works w ON w.id=wc.work_id WHERE ref.face_sheet_id=NEW.id))
BEGIN
  UPDATE blobs SET public_at=CURRENT_TIMESTAMP WHERE public_at IS NULL AND sha256=NEW.blob_sha256;
END;

CREATE TRIGGER character_material_counts_face_insert
AFTER INSERT ON face_sheets BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN
      (SELECT character_id FROM character_face_sheet_bindings WHERE face_sheet_id=NEW.id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_face_update
AFTER UPDATE OF blob_sha256,library_status ON face_sheets
WHEN OLD.blob_sha256 IS NOT NEW.blob_sha256 OR OLD.library_status IS NOT NEW.library_status BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN
      (SELECT character_id FROM character_face_sheet_bindings WHERE face_sheet_id=NEW.id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
