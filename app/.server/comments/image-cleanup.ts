// Hidden comments and temporarily non-public targets remain recoverable.
const disposable = `(i.comment_id IS NULL OR EXISTS(
  SELECT 1 FROM comments c LEFT JOIN comments root ON root.id=c.root_comment_id
  WHERE c.id=i.comment_id AND (
    (c.status='deleted' AND datetime(c.deleted_at)<=datetime('now','-7 days')) OR
    (root.status='deleted' AND datetime(root.deleted_at)<=datetime('now','-7 days'))
  )
))`;

export async function cleanupCommentImages(db: D1Database, bucket: R2Bucket) {
  const candidates = await db.prepare(`SELECT i.id FROM comment_images i WHERE
    i.status='cleanup' OR (i.status IN('ready','uploading','uncertain')
      AND datetime(i.updated_at)<=datetime('now','-7 days') AND ${disposable})
    ORDER BY i.updated_at LIMIT 100`).all<{ id: string }>();
  let cleaned = 0;
  const failed: string[] = [];
  for (const { id } of candidates.results) {
    try {
      // Claim in D1 before deleting R2. Publishing can no longer bind this row.
      const row = await db.prepare(`UPDATE comment_images AS i SET status='cleanup',updated_at=CURRENT_TIMESTAMP
        WHERE i.id=? AND (i.status='cleanup' OR (i.status IN('ready','uploading','uncertain')
          AND datetime(i.updated_at)<=datetime('now','-7 days') AND ${disposable})) RETURNING object_key`)
        .bind(id).first<{ object_key: string }>();
      if (!row) continue;
      await bucket.delete(row.object_key);
      await db.prepare("UPDATE comment_images SET status='cleaned',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='cleanup'").bind(id).run();
      cleaned++;
    } catch (error) {
      failed.push(id);
      console.error("Comment image cleanup failed", id, error);
    }
  }
  return { cleaned, failed };
}
