ALTER TABLE users ADD COLUMN color_theme TEXT NOT NULL DEFAULT 'system'
  CHECK (color_theme IN ('light', 'dark', 'system'));
