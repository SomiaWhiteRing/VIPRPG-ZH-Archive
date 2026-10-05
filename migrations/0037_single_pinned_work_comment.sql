-- Preserve the most recent published pin per game (highest id breaks ties).
-- Only pin metadata changes; comments and replies are retained.
UPDATE comments SET pinned_at=NULL
WHERE pinned_at IS NOT NULL AND status<>'published';

UPDATE comments SET pinned_at=NULL
WHERE id IN (
  SELECT id FROM (
    SELECT id,ROW_NUMBER() OVER (PARTITION BY work_id ORDER BY pinned_at DESC,id DESC) AS position
    FROM comments WHERE pinned_at IS NOT NULL
  ) WHERE position>1
);

CREATE UNIQUE INDEX idx_comments_single_work_pin ON comments(work_id)
WHERE pinned_at IS NOT NULL;
