-- Content deduplication preserves the first uploader; each verified upload
-- separately grants its uploader permission to bind the sheet to characters.
CREATE TABLE face_sheet_uploaders (
  face_sheet_id INTEGER NOT NULL REFERENCES face_sheets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (face_sheet_id, user_id)
);

INSERT INTO face_sheet_uploaders(face_sheet_id, user_id)
SELECT id, created_by_user_id FROM face_sheets
WHERE created_by_user_id IS NOT NULL;
