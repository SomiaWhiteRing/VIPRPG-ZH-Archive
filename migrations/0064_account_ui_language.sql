ALTER TABLE users ADD COLUMN ui_language TEXT NOT NULL DEFAULT 'auto'
  CHECK (ui_language IN ('auto', 'zh-Hans', 'ja', 'en'));
