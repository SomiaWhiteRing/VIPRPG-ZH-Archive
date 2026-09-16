CREATE TABLE character_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  kind TEXT NOT NULL CHECK (kind IN ('charset','monster','other')),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  UNIQUE (blob_sha256,kind)
);

CREATE TABLE character_material_bindings (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES character_materials(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id,material_id)
);
CREATE INDEX idx_character_material_bindings_material ON character_material_bindings(material_id);

CREATE TRIGGER character_materials_require_active_blob_insert
BEFORE INSERT ON character_materials
WHEN NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'character material blob must be active');
END;

CREATE TRIGGER character_materials_require_active_blob_update
BEFORE UPDATE OF blob_sha256 ON character_materials
WHEN NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'character material blob must be active');
END;

DROP TRIGGER blobs_purge_requires_unreferenced;
CREATE TRIGGER blobs_purge_requires_unreferenced
BEFORE UPDATE OF status ON blobs
WHEN NEW.status IN ('purging','purged') AND (
  EXISTS (SELECT 1 FROM archive_version_blob_refs WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM media_assets WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM custom_emojis WHERE image_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM users WHERE avatar_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM creators WHERE avatar_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM face_sheets WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM character_materials WHERE blob_sha256=OLD.sha256)
)
BEGIN
  SELECT RAISE(ABORT, 'referenced blob cannot be purged');
END;
