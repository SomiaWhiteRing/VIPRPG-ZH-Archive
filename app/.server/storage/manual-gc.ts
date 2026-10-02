import type { AppRuntime } from "@/app/.server/runtime";
import { getD1 } from "@/app/.server/db/d1";
import { getArchiveBucket } from "./archive-bucket";
import { blobKey, corePackKey, manifestKey } from "./archive-keys";
import { deleteUnreferencedManifest } from "./gc-manifests";
import type { GcJobAction, GcJobPhase, GcJobReport, GcJobStatus } from "@/lib/archive/gc-job";
import { HttpError } from "@/lib/http";

type Job = {
  id: string; user_id: number; status: GcJobStatus; phase: GcJobPhase; cursor: string;
  grace_days: number; created_at: string; confirmed_at: string | null; scanned_count: number;
};
type Snapshot = {
  created_at?: string; verified_at?: string | null; size_bytes?: number;
  deleted_at?: string; manifest_sha256?: string; total_files?: number; total_size_bytes?: number;
  version?: string | null;
};
type Item = {
  type: "archive" | "blob" | "core_pack" | "manifest"; object_id: string;
  snapshot_json: string; size_bytes: number; file_count: number; object_exists: number;
  state: "pending" | "deleting" | "deleted" | "skipped" | "failed"; error: string | null;
};
type Candidate = Snapshot & { object_id: string };
const phases: GcJobPhase[] = ["archives", "blobs", "core_packs", "manifests"];
const scanPageSize = 15;
const sweepPageSize = 3;
const staleJobDays = 7;

// Canonical object namespaces only: this deliberately never lists/deletes the
// whole bucket, tool packages, forum images, or derived download caches.
function objectKey(type: Item["type"], id: string) {
  return type === "blob" ? blobKey(id) : type === "core_pack" ? corePackKey(id) : manifestKey(id);
}
function externalBlobReferences(alias: string) {
  return `NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM creators c WHERE c.avatar_blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM resources r WHERE r.icon_blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM face_sheets f WHERE f.blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM character_materials m WHERE m.blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM face_emoji_refs e WHERE e.blob_sha256=${alias}.sha256)
    AND NOT EXISTS (SELECT 1 FROM catalogs c WHERE c.cover_blob_sha256=${alias}.sha256 AND c.status='published')`;
}
function objectReferences(type: Item["type"], alias: string, projected = false) {
  const refs = type === "blob" ? "archive_version_blob_refs" : "archive_version_core_pack_refs";
  const key = type === "blob" ? `r.blob_sha256=${alias}.sha256` : `r.core_pack_id=${alias}.id`;
  return `NOT EXISTS (SELECT 1 FROM ${refs} r WHERE ${key}
    ${projected ? `AND NOT EXISTS (SELECT 1 FROM archive_gc_job_items i JOIN archive_versions av
      ON av.id=r.archive_version_id WHERE i.job_id=? AND i.type='archive'
      AND i.object_id=CAST(av.id AS TEXT) AND av.status='deleted' AND av.purged_at IS NULL
      AND av.deleted_at=json_extract(i.snapshot_json,'$.deleted_at')
      AND av.manifest_sha256=json_extract(i.snapshot_json,'$.manifest_sha256'))` : ""})
    ${type === "blob" ? `AND ${externalBlobReferences(alias)}` : ""}`;
}
function locked(jobId: string, token: string) {
  return { sql: "EXISTS (SELECT 1 FROM archive_gc_jobs WHERE id=? AND lock_token=?)", binds: [jobId, token] };
}

export async function handleManualGc(
  runtime: AppRuntime, actor: { id: number; email: string },
  body: { action: GcJobAction; jobId?: string; graceDays?: number; confirm?: string },
): Promise<GcJobReport | null> {
  const db = getD1(runtime);
  if (body.action === "start") {
    if (!Number.isInteger(body.graceDays) || body.graceDays! < 0 || body.graceDays! > 3650) {
      throw new HttpError(400, "保留天数必须是 0 到 3650 的整数");
    }
    const existing = await db.prepare(`SELECT id FROM archive_gc_jobs WHERE user_id=?
      AND status IN ('scanning','ready','running','needs_retry') ORDER BY created_at DESC LIMIT 1`)
      .bind(actor.id).first<{ id: string }>();
    if (existing) return getManualGcReport(db, existing.id, actor.id);
    // Only inactive metadata is expired. Never discard an uncertain deletion.
    await db.prepare(`DELETE FROM archive_gc_jobs WHERE status IN ('completed','cancelled')
      AND datetime(updated_at)<datetime('now',?)
      AND NOT EXISTS (SELECT 1 FROM archive_gc_job_items WHERE job_id=archive_gc_jobs.id AND state='deleting')`)
      .bind(`-${staleJobDays} days`).run();
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO archive_gc_jobs(id,user_id,status,phase,grace_days)
      VALUES(?,?,'scanning','archives',?) ON CONFLICT DO NOTHING`).bind(id, actor.id, body.graceDays!).run();
    const started = await db.prepare(`SELECT id FROM archive_gc_jobs WHERE user_id=?
      AND status IN ('scanning','ready','running','needs_retry') ORDER BY created_at DESC LIMIT 1`)
      .bind(actor.id).first<{ id: string }>();
    return getManualGcReport(db, started!.id, actor.id);
  }
  const job = body.jobId
    ? await db.prepare("SELECT * FROM archive_gc_jobs WHERE id=? AND user_id=?").bind(body.jobId, actor.id).first<Job>()
    : body.action === "status"
      ? await db.prepare("SELECT * FROM archive_gc_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1")
        .bind(actor.id).first<Job>() : null;
  if (!job) {
    if (body.action === "status" && !body.jobId) return null;
    throw new HttpError(404, "清理任务不存在");
  }
  if (body.action === "status") return getManualGcReport(db, job.id, actor.id);
  const token = crypto.randomUUID();
  const acquired = await db.prepare(`UPDATE archive_gc_jobs SET lock_token=?,locked_at=CURRENT_TIMESTAMP
    WHERE id=? AND lock_token IS NULL`)
    .bind(token, job.id).run();
  if (!acquired.meta.changes) throw new HttpError(409, "上一批仍在执行，请稍后刷新；若持续锁定，需管理员核查执行状态", "gc_busy");
  try {
    const current = (await db.prepare("SELECT * FROM archive_gc_jobs WHERE id=?").bind(job.id).first<Job>())!;
    if (body.action === "scan") {
      if (current.status === "scanning") await scanManualGcPage(runtime, current, token);
    } else if (body.action === "confirm") {
      if (body.confirm !== "SWEEP") throw new HttpError(400, "请输入 SWEEP 确认不可恢复的清理");
      if (current.status === "ready") {
        const valid = await db.prepare(`SELECT 1 FROM archive_gc_jobs WHERE id=?
          AND datetime(created_at)>=datetime('now','-1 day')`).bind(job.id).first();
        if (!valid) throw new HttpError(409, "扫描结果已过期，请取消后重新扫描");
        const preview = await getManualGcReport(db, job.id, actor.id);
        await db.batch([
          db.prepare(`UPDATE archive_gc_jobs SET status='running',confirmed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='ready' AND lock_token=?`).bind(job.id, token),
          auditStatement(db, actor, "gc_sweep_confirmed", { jobId: job.id, graceDays: current.grace_days,
            archiveCount: preview.archiveCount, archiveFileCount: preview.archiveFileCount,
            objectCount: preview.objectCount, objectSizeBytes: preview.objectSizeBytes }),
        ]);
      } else if (!current.confirmed_at) throw new HttpError(409, "请先完成扫描，再确认清理");
    } else if (body.action === "run") {
      if (!current.confirmed_at) throw new HttpError(409, "此扫描尚未确认，不能清理");
      if (current.status === "running") await sweepManualGcPage(runtime, current, token, actor);
    } else if (body.action === "retry") {
      if (!current.confirmed_at || current.status !== "needs_retry") throw new HttpError(409, "没有可重试的清理任务");
      await db.batch([
        db.prepare(`UPDATE archive_gc_job_items SET state=CASE WHEN state='failed' THEN 'pending' ELSE state END,error=NULL
          WHERE job_id=? AND (state='failed' OR (state='deleting' AND error IS NOT NULL))`).bind(job.id),
        db.prepare("UPDATE archive_gc_jobs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lock_token=?").bind(job.id, token),
      ]);
    } else if (body.action === "cancel") {
      if (!["scanning", "ready", "cancelled"].includes(current.status)) throw new HttpError(409, "已确认的清理只能暂停，不能撤销已删除的数据");
      await db.prepare("UPDATE archive_gc_jobs SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lock_token=?").bind(job.id, token).run();
    } else throw new HttpError(400, "未知清理操作");
  } finally {
    await db.prepare("UPDATE archive_gc_jobs SET lock_token=NULL,locked_at=NULL WHERE id=? AND lock_token=?").bind(job.id, token).run();
  }
  return getManualGcReport(db, job.id, actor.id);
}

async function scanManualGcPage(runtime: AppRuntime, job: Job, token: string) {
  const db = getD1(runtime);
  let base: string;
  let filtered: string;
  let baseBinds: (string | number)[];
  let filterBinds: string[] = [];
  if (job.phase === "archives") {
    base = `SELECT id,CAST(id AS TEXT) AS cursor_key,deleted_at,manifest_sha256,total_files,total_size_bytes
      FROM archive_versions WHERE id>? AND status='deleted' AND purged_at IS NULL
      ORDER BY id LIMIT ?`;
    baseBinds = [Number(job.cursor || 0), scanPageSize];
    filtered = `SELECT CAST(id AS TEXT) AS object_id,deleted_at,manifest_sha256,total_files,total_size_bytes
      FROM page WHERE deleted_at IS NOT NULL AND datetime(deleted_at)<=datetime(?,?) ORDER BY id`;
    filterBinds = [job.created_at, `-${job.grace_days} days`];
  } else if (job.phase === "manifests") {
    // Page the frozen archive IDs, not GROUP BY over every manifest on each
    // request. The item primary key deduplicates shared manifest objects.
    base = `SELECT object_id AS cursor_key,json_extract(snapshot_json,'$.manifest_sha256') AS manifest_sha256
      FROM archive_gc_job_items WHERE job_id=? AND type='archive' AND object_id>?
      ORDER BY object_id LIMIT ?`;
    baseBinds = [job.id, job.cursor, scanPageSize];
    filtered = `SELECT DISTINCT p.manifest_sha256 AS object_id FROM page p
      WHERE NOT EXISTS (SELECT 1 FROM archive_gc_job_items i WHERE i.job_id=? AND i.type='manifest' AND i.object_id=p.manifest_sha256)
      AND NOT EXISTS (SELECT 1 FROM archive_versions av WHERE av.manifest_sha256=p.manifest_sha256 AND av.purged_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM archive_gc_job_items i WHERE i.job_id=? AND i.type='archive'
          AND i.object_id=CAST(av.id AS TEXT) AND av.status='deleted'
          AND av.deleted_at=json_extract(i.snapshot_json,'$.deleted_at')
          AND av.manifest_sha256=json_extract(i.snapshot_json,'$.manifest_sha256')))`;
    filterBinds = [job.id, job.id];
  } else {
    const type = job.phase === "blobs" ? "blob" : "core_pack";
    base = `SELECT *,sha256 AS cursor_key FROM ${job.phase}
      WHERE sha256>? AND status IN ('active','purging') ORDER BY sha256 LIMIT ?`;
    baseBinds = [job.cursor, scanPageSize];
    filtered = `SELECT b.sha256 AS object_id,b.created_at,b.verified_at,b.size_bytes FROM page b
      WHERE datetime(b.created_at)<=datetime(?,?) AND ${objectReferences(type, "b", true)} ORDER BY b.sha256`;
    filterBinds = [job.created_at, `-${job.grace_days} days`, job.id];
  }
  const [candidateResult, boundsResult] = await db.batch([
    db.prepare(`WITH page AS MATERIALIZED (${base}) ${filtered}`).bind(...baseBinds, ...filterBinds),
    db.prepare(`WITH page AS MATERIALIZED (${base}) SELECT COUNT(*) AS count,
      ${job.phase === "archives" ? "CAST(MAX(id) AS TEXT)" : "MAX(cursor_key)"} AS cursor FROM page`).bind(...baseBinds),
  ]);
  const rows = candidateResult.results as Candidate[];
  const bounds = boundsResult.results[0] as { count: number; cursor: string | null };
  const type: Item["type"] = job.phase === "archives" ? "archive" : job.phase === "blobs" ? "blob" : job.phase === "core_packs" ? "core_pack" : "manifest";
  const items: D1PreparedStatement[] = [];
  for (const row of rows) {
    const { object_id: id, ...snapshot } = row;
    const object = type === "archive" ? null : await getArchiveBucket(runtime).head(objectKey(type, id));
    if (type !== "archive") snapshot.version = object?.version ?? null;
    items.push(db.prepare(`INSERT INTO archive_gc_job_items(job_id,type,object_id,snapshot_json,size_bytes,file_count,object_exists)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM archive_gc_jobs WHERE id=? AND lock_token=? AND status='scanning')
      ON CONFLICT(job_id,type,object_id) DO NOTHING`).bind(job.id, type, id, JSON.stringify(snapshot),
      type === "archive" ? snapshot.total_size_bytes ?? 0 : object?.size ?? 0,
      type === "archive" ? snapshot.total_files ?? 0 : 0, object ? 1 : 0, job.id, token));
  }
  const nextPhase = bounds.count < scanPageSize ? phases[phases.indexOf(job.phase) + 1] : job.phase;
  items.push(db.prepare(`UPDATE archive_gc_jobs SET phase=?,cursor=?,status=?,scanned_count=scanned_count+?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lock_token=? AND status='scanning'`).bind(nextPhase ?? job.phase,
    nextPhase === job.phase ? bounds.cursor ?? job.cursor : "", nextPhase ? "scanning" : "ready", bounds.count, job.id, token));
  // A page is committed only after all HEADs succeeded, so a timeout can retry
  // without inflating totals or approving a partial size scan.
  await db.batch(items);
}

async function sweepManualGcPage(runtime: AppRuntime, job: Job, token: string, actor: { id: number; email: string }) {
  const db = getD1(runtime);
  const rows = (await db.prepare(`SELECT * FROM archive_gc_job_items WHERE job_id=?
    AND state IN ('pending','deleting') AND error IS NULL
    ORDER BY CASE type WHEN 'archive' THEN 0 WHEN 'blob' THEN 1 WHEN 'core_pack' THEN 2 ELSE 3 END,object_id LIMIT ?`)
    .bind(job.id, sweepPageSize).all<Item>()).results;
  for (const item of rows) {
    // Fence retries and overlapping requests before each destructive step.
    const lease = await db.prepare(`UPDATE archive_gc_jobs SET locked_at=CURRENT_TIMESTAMP
      WHERE id=? AND lock_token=?`).bind(job.id, token).run();
    if (!lease.meta.changes) throw new HttpError(409, "清理执行权已变更，请刷新状态", "gc_busy");
    try {
      if (item.type === "archive") await purgeManualArchive(db, job, item, token);
      else await purgeManualObject(runtime, job, item, token);
    } catch (error) {
      console.error("Manual cleanup item failed", job.id, item.type, item.object_id, error);
      await db.prepare(`UPDATE archive_gc_job_items SET state=CASE WHEN state='deleting' THEN 'deleting' ELSE 'failed' END,
        error=? WHERE job_id=? AND type=? AND object_id=? AND state IN ('pending','deleting') AND ${locked(job.id, token).sql}`)
        .bind("删除未完成，已保留进度与安全锁；可以重试", job.id, item.type, item.object_id, job.id, token).run();
    }
  }
  const remaining = await db.prepare(`SELECT
    SUM(CASE WHEN state IN ('pending','deleting') AND error IS NULL THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN state='failed' OR error IS NOT NULL THEN 1 ELSE 0 END) AS failed
    FROM archive_gc_job_items WHERE job_id=?`).bind(job.id).first<{ pending: number; failed: number }>();
  const status = remaining?.pending ? "running" : remaining?.failed ? "needs_retry" : "completed";
  const report = await getManualGcReport(db, job.id, job.user_id);
  await db.batch([
    db.prepare("UPDATE archive_gc_jobs SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lock_token=?").bind(status, job.id, token),
    auditStatement(db, actor, "gc_sweep", { jobId: job.id, status, graceDays: job.grace_days,
      purgedArchiveVersionCount: report.purgedArchiveCount, purgedObjectCount: report.deletedObjectCount,
      purgedSizeBytes: report.deletedSizeBytes, skippedCount: report.skippedCount, failedCount: report.failedCount }),
  ]);
}

async function purgeManualArchive(db: D1Database, job: Job, item: Item, token: string) {
  const s = JSON.parse(item.snapshot_json) as Snapshot;
  const guard = `EXISTS (SELECT 1 FROM archive_gc_job_items WHERE job_id=? AND type='archive' AND object_id=? AND state='deleting')`;
  await db.batch([
    db.prepare(`UPDATE archive_gc_job_items SET state='deleting' WHERE job_id=? AND type='archive' AND object_id=? AND state='pending'
      AND ${locked(job.id, token).sql} AND EXISTS (SELECT 1 FROM archive_versions WHERE id=?
      AND status='deleted' AND purged_at IS NULL AND deleted_at=? AND manifest_sha256=?
      AND total_files=? AND total_size_bytes=? AND datetime(deleted_at)<=datetime(?,?))`)
      .bind(job.id, item.object_id, job.id, token, Number(item.object_id), s.deleted_at!, s.manifest_sha256!, s.total_files!, s.total_size_bytes!, job.created_at, `-${job.grace_days} days`),
    db.prepare(`UPDATE archive_versions SET purged_at=CURRENT_TIMESTAMP,is_current=0 WHERE id=? AND ${guard}`)
      .bind(Number(item.object_id), job.id, item.object_id),
    db.prepare(`DELETE FROM archive_version_blob_refs WHERE archive_version_id=? AND ${guard}`).bind(Number(item.object_id), job.id, item.object_id),
    db.prepare(`DELETE FROM archive_version_core_pack_refs WHERE archive_version_id=? AND ${guard}`).bind(Number(item.object_id), job.id, item.object_id),
    db.prepare(`UPDATE archive_gc_job_items SET state=CASE WHEN state='deleting' THEN 'deleted' ELSE 'skipped' END
      WHERE job_id=? AND type='archive' AND object_id=? AND state IN ('pending','deleting') AND ${locked(job.id, token).sql}`)
      .bind(job.id, item.object_id, job.id, token),
  ]);
}

async function purgeManualObject(runtime: AppRuntime, job: Job, item: Item, token: string) {
  const db = getD1(runtime);
  const bucket = getArchiveBucket(runtime);
  const snapshot = JSON.parse(item.snapshot_json) as Snapshot;
  const head = await bucket.head(objectKey(item.type, item.object_id));
  if (item.state !== "deleting" && (head?.version ?? null) !== snapshot.version) {
    await finishItem(db, job.id, item, token, "skipped");
    return;
  }
  if (item.type === "manifest") {
    // Implemented with the same hash reservation used by the scheduled cleanup.
    await purgeManualManifest(runtime, job, item, token, head, snapshot);
    return;
  }
  const table = item.type === "blob" ? "blobs" : "core_packs";
  if (item.state !== "deleting") {
    await db.batch([
      db.prepare(`UPDATE archive_gc_job_items SET state='deleting'
        WHERE job_id=? AND type=? AND object_id=? AND state='pending' AND ${locked(job.id, token).sql}
        AND EXISTS (SELECT 1 FROM ${table} b WHERE b.sha256=? AND b.status='active'
          AND b.created_at=? AND b.verified_at IS ? AND b.size_bytes=?
          AND datetime(b.created_at)<=datetime(?,?) AND ${objectReferences(item.type, "b")})`)
        .bind(job.id, item.type, item.object_id, job.id, token, item.object_id,
          snapshot.created_at!, snapshot.verified_at ?? null, snapshot.size_bytes!, job.created_at, `-${job.grace_days} days`),
      db.prepare(`UPDATE ${table} SET status='purging' WHERE sha256=? AND EXISTS
        (SELECT 1 FROM archive_gc_job_items WHERE job_id=? AND type=? AND object_id=? AND state='deleting')`)
        .bind(item.object_id, job.id, item.type, item.object_id),
    ]);
    const claimed = await db.prepare(`SELECT state FROM archive_gc_job_items WHERE job_id=? AND type=? AND object_id=?`)
      .bind(job.id, item.type, item.object_id).first<{ state: Item["state"] }>();
    if (claimed?.state !== "deleting") {
      await skipOrDeferObject(db, job.id, item, token);
      return;
    }
  }
  if (head && head.version !== snapshot.version) throw new Error("Reserved R2 object version changed");
  await bucket.delete(objectKey(item.type, item.object_id));
  await db.batch([
    db.prepare(`UPDATE ${table} SET status='purged' WHERE sha256=? AND status='purging' AND ${locked(job.id, token).sql}`)
      .bind(item.object_id, job.id, token),
    db.prepare(`UPDATE archive_gc_job_items SET state='deleted',error=NULL WHERE job_id=? AND type=? AND object_id=?
      AND state='deleting' AND ${locked(job.id, token).sql} AND EXISTS (SELECT 1 FROM ${table} WHERE sha256=? AND status='purged')`)
      .bind(job.id, item.type, item.object_id, job.id, token, item.object_id),
  ]);
}

async function skipOrDeferObject(db: D1Database, jobId: string, item: Item, token: string) {
  const references = item.type === "blob" ? `SELECT r.archive_version_id FROM archive_version_blob_refs r WHERE r.blob_sha256=?`
    : item.type === "core_pack" ? `SELECT r.archive_version_id FROM archive_version_core_pack_refs r JOIN core_packs b ON b.id=r.core_pack_id WHERE b.sha256=?`
      : `SELECT id AS archive_version_id FROM archive_versions WHERE manifest_sha256=? AND purged_at IS NULL`;
  const blocked = await db.prepare(`SELECT 1 FROM (${references}) r JOIN archive_gc_job_items i
    ON i.object_id=CAST(r.archive_version_id AS TEXT) WHERE i.job_id=? AND i.type='archive' AND i.state='failed' LIMIT 1`)
    .bind(item.object_id, jobId).first();
  await db.prepare(`UPDATE archive_gc_job_items SET state=?,error=? WHERE job_id=? AND type=? AND object_id=?
    AND state='pending' AND ${locked(jobId, token).sql}`)
    .bind(blocked ? "failed" : "skipped", blocked ? "依赖的归档清理失败，请一同重试" : null, jobId, item.type, item.object_id, jobId, token).run();
}

async function finishItem(db: D1Database, jobId: string, item: Item, token: string, state: "skipped" | "deleted") {
  await db.prepare(`UPDATE archive_gc_job_items SET state=?,error=NULL WHERE job_id=? AND type=? AND object_id=? AND ${locked(jobId, token).sql}`)
    .bind(state, jobId, item.type, item.object_id, jobId, token).run();
}

async function purgeManualManifest(
  runtime: AppRuntime, job: Job, item: Item, token: string, head: R2Object | null, snapshot: Snapshot,
): Promise<void> {
  const db = getD1(runtime);
  if (item.state !== "deleting") {
    await db.prepare(`UPDATE archive_gc_job_items SET state='deleting' WHERE job_id=? AND type='manifest'
      AND object_id=? AND state='pending' AND ${locked(job.id, token).sql}
      AND NOT EXISTS (SELECT 1 FROM archive_versions WHERE manifest_sha256=? AND purged_at IS NULL)`)
      .bind(job.id, item.object_id, job.id, token, item.object_id).run();
    const claimed = await db.prepare(`SELECT state FROM archive_gc_job_items WHERE job_id=? AND type='manifest' AND object_id=?`)
      .bind(job.id, item.object_id).first<{ state: Item["state"] }>();
    if (claimed?.state !== "deleting") {
      await skipOrDeferObject(db, job.id, item, token);
      return;
    }
  }
  if (head && head.version !== snapshot.version) throw new Error("Reserved manifest version changed");
  const result = await deleteUnreferencedManifest(db, getArchiveBucket(runtime), item.object_id);
  if (result === "busy") throw new Error("Another manifest deletion is in progress");
  await finishItem(db, job.id, item, token, result === "deleted" ? "deleted" : "skipped");
}

function auditStatement(db: D1Database, actor: { id: number; email: string }, event: string, detail: Record<string, unknown>) {
  return db.prepare("INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,?,?)")
    .bind(actor.id, actor.email, event, JSON.stringify(detail));
}

export async function getManualGcReport(db: D1Database, jobId: string, userId: number): Promise<GcJobReport> {
  const job = await db.prepare(`SELECT *,CASE WHEN lock_token IS NOT NULL
    AND (locked_at IS NULL OR datetime(locked_at)<datetime('now','-10 minutes')) THEN 1 ELSE 0 END AS stale_lock
    FROM archive_gc_jobs WHERE id=? AND user_id=?`).bind(jobId, userId)
    .first<Job & { lock_token: string | null; locked_at: string | null; stale_lock: number }>();
  if (!job) throw new HttpError(404, "清理任务不存在");
  const manifestLocks = await db.prepare(`SELECT COUNT(*) AS count,
    COALESCE(SUM(CASE WHEN d.locked_at IS NULL OR datetime(d.locked_at)<datetime('now','-10 minutes') THEN 1 ELSE 0 END),0) AS stale
    FROM archive_gc_manifest_deletions d JOIN archive_gc_job_items i
      ON i.type='manifest' AND i.object_id=d.sha256
    WHERE i.job_id=? AND i.state IN ('pending','deleting','failed') AND d.lock_token IS NOT NULL`)
    .bind(jobId).first<{ count: number; stale: number }>();
  const rows = (await db.prepare(`SELECT type,state,COUNT(*) AS count,SUM(size_bytes) AS bytes,SUM(file_count) AS files,
    SUM(object_exists) AS objects,SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
    FROM archive_gc_job_items WHERE job_id=? GROUP BY type,state`).bind(jobId).all<{
      type: Item["type"]; state: Item["state"]; count: number; bytes: number; files: number; objects: number; errors: number;
    }>()).results;
  const report: GcJobReport = { id: job.id, status: job.status, phase: job.phase, graceDays: job.grace_days,
    createdAt: job.created_at, confirmedAt: job.confirmed_at, scannedCount: job.scanned_count,
    archiveCount: 0, archiveFileCount: 0, archiveSizeBytes: 0, objectCount: 0, objectSizeBytes: 0, missingObjectCount: 0,
    totalItems: 0, processedItems: 0, purgedArchiveCount: 0, deletedObjectCount: 0, deletedSizeBytes: 0, skippedCount: 0, failedCount: 0, failures: [],
    safetyLocks: { executionLockedAt: job.lock_token ? job.locked_at : null, staleExecution: Boolean(job.stale_lock),
      manifestCount: manifestLocks?.count ?? 0, staleManifestCount: manifestLocks?.stale ?? 0 } };
  for (const row of rows) {
    report.totalItems += row.count;
    if (row.state !== "pending" && row.state !== "deleting") report.processedItems += row.count;
    else report.processedItems += row.errors;
    if (row.type === "archive") {
      report.archiveCount += row.count; report.archiveFileCount += row.files; report.archiveSizeBytes += row.bytes;
      if (row.state === "deleted") report.purgedArchiveCount += row.count;
    } else {
      report.objectCount += row.objects; report.objectSizeBytes += row.bytes; report.missingObjectCount += row.count - row.objects;
      if (row.state === "deleted") { report.deletedObjectCount += row.objects; report.deletedSizeBytes += row.bytes; }
    }
    if (row.state === "skipped") report.skippedCount += row.count;
    report.failedCount += row.state === "failed" ? row.count : row.errors;
  }
  report.failures = (await db.prepare(`SELECT type,object_id AS key,error FROM archive_gc_job_items
    WHERE job_id=? AND error IS NOT NULL ORDER BY type,object_id LIMIT 20`).bind(jobId).all<GcJobReport["failures"][number]>()).results;
  return report;
}
