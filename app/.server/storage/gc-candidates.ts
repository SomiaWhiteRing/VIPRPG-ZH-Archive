export type GcObjectType = "blob" | "core_pack";
type ScanCursor = { sha256: string };
export type GcCandidate = {
  id: string; sha256: string; size_bytes: number; created_at: string;
  total_reference_count: number; live_reference_count: number; deleted_reference_count: number;
};
type ScanBounds = { sha256: string; scanned_count: number };

// Limit the objects inspected, including retained objects, before testing references.
// A persistent cursor prevents a retained prefix from starving later garbage.
export async function scanGcCandidates(db: D1Database, type: GcObjectType, graceDays: number, limit: number) {
  const previous = await db.prepare("SELECT sha256 FROM archive_gc_cursors WHERE object_type=?")
    .bind(type).first<ScanCursor>();
  const scanLimit = limit * 10;
  const table = type === "blob" ? "blobs" : "core_packs";
  const candidates = `WITH candidates AS MATERIALIZED (
    SELECT sha256 AS id,sha256,size_bytes,created_at
      ${type === "core_pack" ? ",id AS core_pack_id" : ""}
    FROM ${table}
    WHERE status IN ('active','purging') ${previous ? "AND sha256>?" : ""}
    ORDER BY sha256 LIMIT ?
  )`;
  const binds = [...(previous ? [previous.sha256] : []), scanLimit];
  const references = type === "blob" ? `
    NOT EXISTS (SELECT 1 FROM archive_version_blob_refs r WHERE r.blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM creators c WHERE c.avatar_blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM resources r WHERE r.icon_blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM face_sheets f WHERE f.blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM character_materials m WHERE m.blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM face_emoji_refs e WHERE e.blob_sha256=b.sha256)
    AND NOT EXISTS (SELECT 1 FROM catalogs c WHERE c.cover_blob_sha256=b.sha256 AND c.status='published')`
    : "NOT EXISTS (SELECT 1 FROM archive_version_core_pack_refs r WHERE r.core_pack_id=b.core_pack_id)";
  const [eligible, boundsResult] = await db.batch([
    db.prepare(`${candidates}
      SELECT b.*,0 AS total_reference_count,0 AS live_reference_count,0 AS deleted_reference_count
      FROM candidates b WHERE datetime(created_at)<=datetime('now',?) AND ${references}
      ORDER BY sha256 LIMIT ?`).bind(...binds, `-${graceDays} days`, limit),
    db.prepare(`${candidates}
      SELECT sha256,(SELECT COUNT(*) FROM candidates) AS scanned_count
      FROM candidates ORDER BY sha256 DESC LIMIT 1`).bind(...binds),
  ]);
  const rows = eligible.results as GcCandidate[];
  const bounds = boundsResult.results[0] as ScanBounds | undefined;
  // Never move past eligible rows that did not fit the purge budget.
  const last = rows.length === limit ? rows.at(-1) : bounds;
  const completed = rows.length < limit && (!bounds || bounds.scanned_count < scanLimit);
  const next: ScanCursor | null = completed || !last ? null
    : { sha256: last.sha256 };
  return { rows, previous, next, scannedCount: bounds?.scanned_count ?? 0, completed };
}

// Advance only after sweeping. A failed invocation can retry its old page safely;
// compare-and-swap prevents an overlapping invocation from overwriting progress.
export async function advanceGcCursor(
  db: D1Database, type: GcObjectType, scan: Awaited<ReturnType<typeof scanGcCandidates>>,
) {
  const { previous, next } = scan;
  if (previous) {
    if (next) {
      await db.prepare(`UPDATE archive_gc_cursors SET sha256=?
        WHERE object_type=? AND sha256=?`)
        .bind(next.sha256, type, previous.sha256).run();
    } else {
      await db.prepare("DELETE FROM archive_gc_cursors WHERE object_type=? AND sha256=?")
        .bind(type, previous.sha256).run();
    }
  } else if (next) {
    await db.prepare(`INSERT INTO archive_gc_cursors(object_type,sha256) VALUES(?,?)
      ON CONFLICT(object_type) DO NOTHING`).bind(type, next.sha256).run();
  }
}
