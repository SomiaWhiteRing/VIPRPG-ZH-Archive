-- Download projection; the immutable manifest remains the source of the policy.
ALTER TABLE archive_versions ADD COLUMN uses_shared_player INTEGER NOT NULL DEFAULT 0 CHECK(uses_shared_player IN (0,1));
-- Computed from verified executable bytes, never supplied by an uploader.
ALTER TABLE tool_artifacts ADD COLUMN crc32 INTEGER CHECK(crc32 BETWEEN 0 AND 4294967295);
CREATE TRIGGER tool_artifacts_crc32_immutable BEFORE UPDATE OF crc32 ON tool_artifacts
WHEN OLD.crc32 IS NOT NULL AND NEW.crc32 IS NOT OLD.crc32
BEGIN SELECT RAISE(ABORT,'artifact CRC32 is immutable'); END;
