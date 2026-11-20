UPDATE timeline_events
SET archive_version_id=NULL
WHERE kind='upload' AND archive_version_id IS NOT NULL;

-- Older Workers still include this column when a migration precedes their replacement.
CREATE TRIGGER timeline_upload_uses_work AFTER INSERT ON timeline_events
WHEN NEW.kind='upload' AND NEW.archive_version_id IS NOT NULL
BEGIN
  UPDATE timeline_events SET archive_version_id=NULL WHERE id=NEW.id;
END;

UPDATE netplay_match_seats AS seat
SET work_id=archive.work_id
FROM archive_versions AS archive
WHERE seat.work_id IS NULL AND seat.archive_version_id=archive.id;
