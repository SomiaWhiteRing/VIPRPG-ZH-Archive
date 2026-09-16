CREATE TABLE character_categories (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT REFERENCES character_categories(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  original_name TEXT,
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (parent_id IS NOT id)
);
CREATE INDEX idx_character_categories_parent_order ON character_categories(parent_id,sort_order,id);

CREATE TABLE character_category_memberships (
  category_id TEXT NOT NULL REFERENCES character_categories(id) ON DELETE RESTRICT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 160),
  original_name TEXT CHECK (original_name IS NULL OR length(trim(original_name)) BETWEEN 1 AND 160),
  PRIMARY KEY (category_id,character_id)
);
CREATE INDEX idx_character_memberships_character ON character_category_memberships(character_id);
CREATE INDEX idx_character_memberships_order ON character_category_memberships(category_id,sort_order,character_id);

CREATE TABLE character_sources (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id,url)
);
