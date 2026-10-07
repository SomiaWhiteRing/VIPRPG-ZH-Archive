-- The administrator audience starts with type, not target_user_id.
-- Include the role fields needed for visibility so this scan stays covering.
CREATE INDEX idx_inbox_role_audience
  ON inbox_items(type,requested_role_id,requested_role_key_snapshot);

-- A single revision invalidates only the stable public directory tables.
CREATE TABLE character_index_revision (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO character_index_revision(id,revision) VALUES(1,0);

CREATE TRIGGER character_categories_index_insert
AFTER INSERT ON character_categories BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_categories_index_update
AFTER UPDATE ON character_categories BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_categories_index_delete
AFTER DELETE ON character_categories BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_category_memberships_index_insert
AFTER INSERT ON character_category_memberships BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_category_memberships_index_update
AFTER UPDATE ON character_category_memberships BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_category_memberships_index_delete
AFTER DELETE ON character_category_memberships BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_sources_index_insert
AFTER INSERT ON character_sources BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_sources_index_update
AFTER UPDATE ON character_sources BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_sources_index_delete
AFTER DELETE ON character_sources BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_aliases_index_insert
AFTER INSERT ON character_aliases BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_aliases_index_update
AFTER UPDATE ON character_aliases BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;

CREATE TRIGGER character_aliases_index_delete
AFTER DELETE ON character_aliases BEGIN
  UPDATE character_index_revision SET revision=revision+1 WHERE id=1;
END;
