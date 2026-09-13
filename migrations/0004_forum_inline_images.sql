ALTER TABLE forum_images ADD COLUMN body_offset INTEGER NOT NULL DEFAULT 0 CHECK(body_offset BETWEEN 0 AND 20000);
-- Existing attachments become the last blocks of the same mixed body model.
-- JavaScript selections use UTF-16 offsets; SQLite length counts code points.
WITH RECURSIVE lengths(id,body,pos,units) AS (
  SELECT id,body,1,0 FROM forum_posts WHERE id IN (SELECT post_id FROM forum_images)
  UNION ALL
  SELECT id,body,pos+1,units+CASE WHEN unicode(substr(body,pos,1))>65535 THEN 2 ELSE 1 END
  FROM lengths WHERE pos<=length(body)
)
UPDATE forum_images SET body_offset=COALESCE((SELECT units FROM lengths WHERE id=forum_images.post_id AND pos=length(body)+1),0);
