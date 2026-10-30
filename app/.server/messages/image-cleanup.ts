/** Recover interrupted single-image sends without retaining unattached R2 objects. */
export async function cleanupDirectMessageImages(db: D1Database, bucket: R2Bucket) {
  const candidates = await db.prepare(`SELECT id FROM direct_message_images WHERE state='cleanup'
    OR (state='uploading' AND created_at<=datetime('now','-7 days')) ORDER BY created_at LIMIT 100`).all<{ id: string }>();
  for (const { id } of candidates.results) {
    const row = await db.prepare(`UPDATE direct_message_images SET state='cleanup' WHERE id=?
      AND (state='cleanup' OR (state='uploading' AND created_at<=datetime('now','-7 days')))
      RETURNING object_key`).bind(id).first<{ object_key: string }>();
    if (!row) continue;
    await bucket.delete(row.object_key);
    await db.prepare("UPDATE direct_message_images SET state='cleaned' WHERE id=? AND state='cleanup'").bind(id).run();
  }
}
