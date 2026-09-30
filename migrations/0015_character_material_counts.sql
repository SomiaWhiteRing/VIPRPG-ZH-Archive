-- Material counts are read on every character index request. Recalculate only
-- affected characters when a binding, approval or blob eligibility changes.
CREATE TABLE character_material_counts (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  material_count INTEGER NOT NULL CHECK (material_count >= 0)
);

CREATE VIEW character_material_totals AS
SELECT ch.id AS character_id,
  (SELECT COUNT(*) FROM character_face_sheet_bindings binding
   CROSS JOIN face_sheets fs ON fs.id=binding.face_sheet_id
   CROSS JOIN blobs b ON b.sha256=fs.blob_sha256
   WHERE binding.character_id=ch.id AND fs.library_status='approved'
     AND b.status='active' AND b.content_type_hint LIKE 'image/%')
  + (SELECT COUNT(*) FROM character_material_bindings binding
     CROSS JOIN character_materials m ON m.id=binding.material_id
     CROSS JOIN blobs b ON b.sha256=m.blob_sha256
     WHERE binding.character_id=ch.id AND b.status='active'
       AND b.content_type_hint LIKE 'image/%') AS material_count
FROM characters ch;

INSERT INTO character_material_counts SELECT * FROM character_material_totals;

CREATE TRIGGER character_material_counts_face_binding_insert
AFTER INSERT ON character_face_sheet_bindings BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id=NEW.character_id
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_face_binding_delete
AFTER DELETE ON character_face_sheet_bindings BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id=OLD.character_id
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_face_binding_update
AFTER UPDATE OF character_id,face_sheet_id ON character_face_sheet_bindings
WHEN OLD.character_id IS NOT NEW.character_id OR OLD.face_sheet_id IS NOT NEW.face_sheet_id BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN(OLD.character_id,NEW.character_id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;

CREATE TRIGGER character_material_counts_binding_insert
AFTER INSERT ON character_material_bindings BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id=NEW.character_id
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_binding_delete
AFTER DELETE ON character_material_bindings BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id=OLD.character_id
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_binding_update
AFTER UPDATE OF character_id,material_id ON character_material_bindings
WHEN OLD.character_id IS NOT NEW.character_id OR OLD.material_id IS NOT NEW.material_id BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN(OLD.character_id,NEW.character_id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
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
CREATE TRIGGER character_material_counts_material_insert
AFTER INSERT ON character_materials BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN
      (SELECT character_id FROM character_material_bindings WHERE material_id=NEW.id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
CREATE TRIGGER character_material_counts_material_update
AFTER UPDATE OF blob_sha256 ON character_materials
WHEN OLD.blob_sha256 IS NOT NEW.blob_sha256 BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN
      (SELECT character_id FROM character_material_bindings WHERE material_id=NEW.id)
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;

CREATE TRIGGER character_material_counts_blob_update
AFTER UPDATE OF status,content_type_hint ON blobs
WHEN OLD.status IS NOT NEW.status OR OLD.content_type_hint IS NOT NEW.content_type_hint BEGIN
  INSERT INTO character_material_counts
    SELECT * FROM character_material_totals WHERE character_id IN (
      SELECT binding.character_id FROM character_face_sheet_bindings binding
      JOIN face_sheets fs ON fs.id=binding.face_sheet_id WHERE fs.blob_sha256=NEW.sha256
      UNION
      SELECT binding.character_id FROM character_material_bindings binding
      JOIN character_materials m ON m.id=binding.material_id WHERE m.blob_sha256=NEW.sha256
    )
    ON CONFLICT(character_id) DO UPDATE SET material_count=excluded.material_count;
END;
