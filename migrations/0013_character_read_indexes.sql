CREATE INDEX idx_character_materials_kind_id ON character_materials(kind,id);

CREATE INDEX idx_face_sheets_library_order ON face_sheets(
  CASE library_status WHEN 'approved' THEN 0 ELSE 1 END,
  source_order IS NULL,source_order,id
) WHERE library_status!='rejected';

CREATE INDEX idx_comments_character_public ON comments(character_id)
  WHERE character_id IS NOT NULL AND status='published';
