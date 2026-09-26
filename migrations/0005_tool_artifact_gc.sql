-- Keep release identities indefinitely; reclaim superseded package bytes only.
CREATE VIEW tool_artifact_gc_candidates AS
SELECT a.*, r.resource_id, r.channel, r.version_label, r.release_sequence,
  (SELECT newer.id FROM tool_artifacts newer
   JOIN tool_releases nr ON nr.id=newer.release_id
   WHERE nr.resource_id=r.resource_id AND nr.channel=r.channel
     AND newer.target=a.target AND nr.status='published'
     AND newer.storage_status='ready' AND nr.release_sequence>r.release_sequence
   ORDER BY nr.release_sequence DESC LIMIT 1) AS replacement_id
FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id
WHERE r.published_at IS NOT NULL AND (
  a.storage_status='cleanup' OR (
    a.storage_status='ready'
    AND NOT EXISTS(SELECT 1 FROM tool_channels c WHERE c.artifact_id=a.id)
    AND EXISTS(SELECT 1 FROM tool_artifacts newer
      JOIN tool_releases nr ON nr.id=newer.release_id
      WHERE nr.resource_id=r.resource_id AND nr.channel=r.channel
        AND newer.target=a.target AND nr.status='published'
        AND newer.storage_status='ready' AND nr.release_sequence>r.release_sequence)
  )
);

DROP TRIGGER tool_artifacts_identity_immutable;
CREATE TRIGGER tool_artifacts_identity_immutable BEFORE UPDATE ON tool_artifacts
WHEN NEW.id<>OLD.id OR NEW.release_id<>OLD.release_id OR NEW.target<>OLD.target OR NEW.format<>OLD.format OR
 NEW.application_build_id IS NOT OLD.application_build_id OR NEW.filename<>OLD.filename OR NEW.object_key<>OLD.object_key OR NEW.size_bytes<>OLD.size_bytes OR NEW.sha256<>OLD.sha256 OR
 (EXISTS(SELECT 1 FROM tool_releases WHERE id=OLD.release_id AND published_at IS NOT NULL) AND NEW.storage_status<>OLD.storage_status AND NOT (
   (OLD.storage_status='ready' AND NEW.storage_status='cleanup' AND EXISTS(SELECT 1 FROM tool_artifact_gc_candidates WHERE id=OLD.id)) OR
   (OLD.storage_status='cleanup' AND NEW.storage_status='cleaned')
 )) OR
 (OLD.storage_status IN ('cleanup','cleaned') AND NEW.storage_status NOT IN ('cleanup','cleaned'))
BEGIN SELECT RAISE(ABORT,'artifact identity is immutable'); END;

-- Concurrent editor actions must reload after automatic cleanup.
CREATE TRIGGER tool_artifacts_gc_revision AFTER UPDATE OF storage_status ON tool_artifacts
WHEN NEW.storage_status<>OLD.storage_status AND EXISTS(
 SELECT 1 FROM tool_releases WHERE id=NEW.release_id AND published_at IS NOT NULL)
BEGIN
 UPDATE resources SET revision=revision+1 WHERE id=(SELECT resource_id FROM tool_releases WHERE id=NEW.release_id);
END;
