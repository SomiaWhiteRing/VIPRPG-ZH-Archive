ALTER TABLE users ADD COLUMN show_game_card_interaction_data INTEGER NOT NULL DEFAULT 1
  CHECK (show_game_card_interaction_data IN (0, 1));
