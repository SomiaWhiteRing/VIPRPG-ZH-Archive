import { getD1 } from "@/app/.server/db/d1";
import { findUserByEmail } from "@/app/.server/db/users";
import type { AppRuntime } from "@/app/.server/runtime";
import { canMergeWorks, hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";

export async function listWorkMaintainers(runtime: AppRuntime, workId: number) {
  const rows = await getD1(runtime)
    .prepare(
      `SELECT u.id,u.display_name AS name,u.email,u.status
    FROM work_uploaders wu JOIN users u ON u.id=wu.user_id WHERE wu.work_id=? ORDER BY u.id`,
    )
    .bind(workId)
    .all<{ id: number; name: string; email: string | null; status: string }>();
  return rows.results ?? [];
}

export async function setWorkMaintainer(
  runtime: AppRuntime,
  actor: ArchiveUser,
  workId: number,
  email: string,
  remove: boolean,
) {
  if (!hasPermission(actor, "work.maintainer.manage_any"))
    throw new HttpError(403, "没有管理作品维护者的权限");
  const user = await findUserByEmail(runtime, email);
  if (
    !user ||
    (!remove &&
      (user.status !== "active" || !hasPermission(user, "work.update_own")))
  )
    throw new HttpError(400, "请选择拥有作品维护权限的正常账户");
  const db = getD1(runtime);
  if (
    !(await db.prepare(`SELECT id FROM works WHERE id=?`).bind(workId).first())
  )
    throw new HttpError(404, "作品不存在");
  await db.batch([
    remove
      ? db
          .prepare(`DELETE FROM work_uploaders WHERE work_id=? AND user_id=?`)
          .bind(workId, user.id)
      : db
          .prepare(
            `INSERT OR IGNORE INTO work_uploaders(work_id,user_id) VALUES(?,?)`,
          )
          .bind(workId, user.id),
    audit(db, actor, "work_maintainer_changed", {
      workId,
      userId: user.id,
      remove,
    }),
  ]);
}

export async function mergeCreators(
  runtime: AppRuntime,
  actor: ArchiveUser,
  source: number,
  target: number,
) {
  if (!hasPermission(actor, "creator.merge_any"))
    throw new HttpError(403, "无权合并人物");
  const db = getD1(runtime);
  await requirePair(db, "creators", source, target);
  const conflicts = await db
    .prepare(
      `SELECT 1 FROM work_staff s JOIN work_staff t
    ON t.work_id=s.work_id AND t.role_key=s.role_key WHERE s.creator_id=? AND t.creator_id=?
    AND (s.display_name<>t.display_name OR s.role_label IS NOT t.role_label OR s.notes IS NOT t.notes) LIMIT 1`,
    )
    .bind(source, target)
    .first();
  if (conflicts)
    throw new HttpError(
      409,
      "两个人物在同一作品的相同职务中有不同署名或备注，请先统一后再合并",
    );
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO creator_aliases(creator_id,name,name_key,source)
      SELECT ?,name,name_key,'admin' FROM creators WHERE id=?`,
      )
      .bind(target, source),
    db
      .prepare(`UPDATE creator_aliases SET creator_id=? WHERE creator_id=?`)
      .bind(target, source),
    db
      .prepare(
        `INSERT OR IGNORE INTO work_staff(work_id,creator_id,display_name,role_key,role_label,notes)
      SELECT work_id,?,display_name,role_key,role_label,notes FROM work_staff WHERE creator_id=?`,
      )
      .bind(target, source),
    db
      .prepare(`UPDATE comments SET creator_id=? WHERE creator_id=?`)
      .bind(target, source),
    db.prepare(`UPDATE user_showcase_entries SET creator_id=? WHERE creator_id=?`).bind(target, source),
    db.prepare(`DELETE FROM creators WHERE id=?`).bind(source),
    audit(db, actor, "creators_merged", { source, target }),
  ]);
}

export async function mergeWorks(
  runtime: AppRuntime,
  actor: ArchiveUser,
  source: number,
  target: number,
) {
  if (!canMergeWorks(actor)) throw new HttpError(403, "无权合并作品");
  const db = getD1(runtime);
  await requirePair(db, "works", source, target);
  const pair = await db
    .prepare(
      `SELECT id,language,engine_family,status FROM works WHERE id IN (?,?)`,
    )
    .bind(source, target)
    .all<{
      id: number;
      language: string;
      engine_family: string;
      status: string;
    }>();
  const [a, b] = pair.results ?? [];
  if (
    a.language !== b.language ||
    a.engine_family !== b.engine_family ||
    [a.status, b.status].includes("processing")
  )
    throw new HttpError(409, "仅可合并同语言、同引擎且已结束上传的重复作品");
  if (
    await db
      .prepare(`SELECT 1 FROM works WHERE id=? AND status='deleted'`)
      .bind(target)
      .first()
  )
    throw new HttpError(409, "请先恢复目标作品");
  if (
    await db
      .prepare(
        `SELECT 1 FROM import_jobs WHERE work_id IN (?,?) AND status NOT IN ('completed','failed','canceled','expired') LIMIT 1`,
      )
      .bind(source, target)
      .first()
  )
    throw new HttpError(409, "作品仍有进行中的上传，请先结束上传");
  await assertMergeCover(db, target);
  await assertWorkMergeDeclarations(db, source, target);
  await assertArchiveMergeStates(db, source, target);
  // Refuse ambiguous merges instead of dropping files, credits, or catalog annotations.
  const conflicts = await db.batch([
    db
      .prepare(
        `SELECT 1 FROM work_staff s JOIN work_staff t ON s.creator_id=t.creator_id AND s.role_key=t.role_key WHERE s.work_id=? AND t.work_id=? AND (s.display_name<>t.display_name OR s.role_label IS NOT t.role_label OR s.notes IS NOT t.notes) LIMIT 1`,
      )
      .bind(source, target),
    db
      .prepare(
        `SELECT 1 FROM catalog_items s JOIN catalog_items t ON s.catalog_id=t.catalog_id WHERE s.work_id=? AND t.work_id=? AND s.note IS NOT t.note LIMIT 1`,
      )
      .bind(source, target),
  ]);
  if (conflicts.some((r) => r.results?.length))
    throw new HttpError(409, "署名／目录备注不同，请先在后台处理冲突后再合并");
  const statements: D1PreparedStatement[] = [];
  statements.push(
    db.prepare(`UPDATE works SET updated_at=CASE WHEN EXISTS (SELECT 1 FROM work_media_assets WHERE work_id=? AND role='cover') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?`).bind(target, target),
    db.prepare(`INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,role)
      SELECT ?,s.media_asset_id,
        COALESCE((SELECT MAX(sort_order) FROM work_media_assets WHERE work_id=?),0)
          + ROW_NUMBER() OVER (ORDER BY (s.role='cover') DESC,s.sort_order,s.media_asset_id),'preview'
      FROM work_media_assets s WHERE s.work_id=? AND NOT EXISTS
        (SELECT 1 FROM work_media_assets t WHERE t.work_id=? AND t.media_asset_id=s.media_asset_id)`)
      .bind(target,target,source,target),
    db.prepare("DELETE FROM work_media_assets WHERE work_id=?").bind(source),
  );
  // Enforce the declaration check again inside the batch. NULL violates the
  // existing NOT NULL constraint and aborts the transaction before any transfer.
  statements.push(
    db
      .prepare(
        `UPDATE works SET is_translation=CASE WHEN EXISTS (
    SELECT 1 FROM works t WHERE t.id=? AND t.is_translation=works.is_translation AND t.is_original=works.is_original
  ) THEN is_translation ELSE NULL END WHERE id=?`,
      )
      .bind(target, source),
  );
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO work_titles(work_id,title,title_type)
    SELECT ?,original_title,'alias' FROM works WHERE id=?`,
      )
      .bind(target, source),
  );
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO work_titles(work_id,title,title_type)
    SELECT ?,chinese_title,'alias' FROM works WHERE id=? AND chinese_title IS NOT NULL`,
      )
      .bind(target, source),
  );
  // Identical manifests represent the same files. Keep the target archive ID and all its references.
  for (const [table, column] of [
    ["archive_version_blob_refs", "blob_sha256"],
    ["archive_version_core_pack_refs", "core_pack_id"],
  ]) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO ${table}(archive_version_id,${column})
      SELECT t.id,r.${column} FROM ${table} r JOIN archive_versions s ON s.id=r.archive_version_id
      JOIN archive_versions t ON t.manifest_sha256=s.manifest_sha256 AND t.work_id=? WHERE s.work_id=?`,
        )
        .bind(target, source),
    );
  }
  for (const table of ["import_jobs", "download_builds"]) {
    statements.push(
      db
        .prepare(
          `UPDATE ${table} SET archive_version_id=(SELECT t.id FROM archive_versions s
      JOIN archive_versions t ON t.manifest_sha256=s.manifest_sha256 AND t.work_id=? WHERE s.id=${table}.archive_version_id)
      WHERE archive_version_id IN (SELECT s.id FROM archive_versions s JOIN archive_versions t
      ON t.manifest_sha256=s.manifest_sha256 AND t.work_id=? WHERE s.work_id=?)`,
        )
        .bind(target, target, source),
    );
  }
  // Recheck inside the transaction. A mismatched pair remains duplicated, so the
  // later work_id update violates UNIQUE(work_id,manifest_sha256) and rolls back
  // the entire batch, including reference transfers. Never inherit a deletion.
  statements.push(
    db
      .prepare(
        `DELETE FROM archive_versions WHERE work_id=? AND EXISTS
    (SELECT 1 FROM archive_versions t WHERE t.work_id=? AND t.manifest_sha256=archive_versions.manifest_sha256
      AND t.status=archive_versions.status
      AND (t.purged_at IS NULL)=(archive_versions.purged_at IS NULL))`,
      )
      .bind(source, target),
  );
  for (const [table, columns] of [
    ["work_uploaders", "user_id,created_at"],
    ["work_titles", "title,language,title_type,is_searchable,created_at"],
    ["work_staff", "creator_id,display_name,role_key,role_label,notes"],
    ["work_tags", "tag_id,source,created_at"],
    ["catalog_items", "catalog_id,sort_order,note,created_at"],
  ]) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO ${table}(work_id,${columns}) SELECT ?,${columns} FROM ${table} WHERE work_id=?`,
        )
        .bind(target, source),
    );
    statements.push(
      db.prepare(`DELETE FROM ${table} WHERE work_id=?`).bind(source),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO user_work_entries(work_id,user_id,last_played_at,favorited_at,updated_at)
      SELECT ?,user_id,last_played_at,favorited_at,updated_at FROM user_work_entries WHERE work_id=?
      ON CONFLICT(work_id,user_id) DO UPDATE SET last_played_at=CASE
        WHEN last_played_at IS NULL THEN excluded.last_played_at
        WHEN excluded.last_played_at IS NULL THEN last_played_at
        ELSE MAX(last_played_at,excluded.last_played_at) END,
      favorited_at=COALESCE(favorited_at,excluded.favorited_at),updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(target, source),
    db.prepare(`DELETE FROM user_work_entries WHERE work_id=?`).bind(source),
    db.prepare(`UPDATE user_showcase_entries SET work_id=? WHERE work_id=?`).bind(target, source),
    db
      .prepare(
        `INSERT INTO work_engagement_stats(work_id,view_count) SELECT ?,view_count FROM work_engagement_stats WHERE work_id=?
      ON CONFLICT(work_id) DO UPDATE SET view_count=view_count+excluded.view_count`,
      )
      .bind(target, source),
    db
      .prepare(`DELETE FROM work_engagement_stats WHERE work_id=?`)
      .bind(source),
    db
      .prepare(`UPDATE comments SET work_id=? WHERE work_id=?`)
      .bind(target, source),
    db
      .prepare(`UPDATE work_characters SET work_id=? WHERE work_id=?`)
      .bind(target, source),
    db
      .prepare(`UPDATE archive_versions SET is_current=0 WHERE work_id=?`)
      .bind(source),
    db
      .prepare(`UPDATE archive_versions SET work_id=? WHERE work_id=?`)
      .bind(target, source),
    db
      .prepare(`UPDATE import_jobs SET work_id=? WHERE work_id=?`)
      .bind(target, source),
    // Keep the target's download address when merging works.
    db.prepare("DELETE FROM work_external_links WHERE work_id=? AND link_type='download_page'").bind(source),
    db
      .prepare(
        `UPDATE work_external_links SET work_id=? WHERE work_id=?`,
      )
      .bind(target, source),
  );
  for (const [table, from, to] of [
    ["work_relations", "from_work_id", "to_work_id"],
    ["translation_relations", "source_work_id", "target_work_id"],
  ]) {
    statements.push(
      db
        .prepare(
          `DELETE FROM ${table} WHERE (${from}=? AND ${to}=?) OR (${from}=? AND ${to}=?)`,
        )
        .bind(source, target, target, source),
    );
    statements.push(
      db
        .prepare(
          `UPDATE ${table} SET ${from}=CASE WHEN ${from}=? THEN ? ELSE ${from} END,${to}=CASE WHEN ${to}=? THEN ? ELSE ${to} END WHERE ${from}=? OR ${to}=?`,
        )
        .bind(source, target, source, target, source, source),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE works SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(source),
    audit(db, actor, "works_merged", { source, target }),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    await assertWorkMergeDeclarations(db, source, target);
    await assertArchiveMergeStates(db, source, target);
    if (/constraint|translation.*conflict/i.test(String(error)))
      throw new HttpError(
        409,
        "关联存在冲突，合并已全部撤销；请先在后台统一关联",
      );
    throw error;
  }
}

async function assertWorkMergeDeclarations(
  db: D1Database,
  source: number,
  target: number,
) {
  const conflict = await db
    .prepare(
      `SELECT 1 FROM works s JOIN works t ON t.id=? WHERE s.id=?
    AND (s.is_translation<>t.is_translation OR s.is_original<>t.is_original)`,
    )
    .bind(target, source)
    .first();
  if (conflict)
    throw new HttpError(
      409,
      `作品 #${source} 与 #${target} 的翻译或原创声明不同，请先统一声明后再合并。`,
    );
}

async function assertArchiveMergeStates(
  db: D1Database,
  source: number,
  target: number,
) {
  const conflict = await db
    .prepare(
      `SELECT s.id AS source_id,t.id AS target_id,s.status AS source_status,
      t.status AS target_status,s.purged_at AS source_purged_at,t.purged_at AS target_purged_at
    FROM archive_versions s JOIN archive_versions t ON t.manifest_sha256=s.manifest_sha256
    WHERE s.work_id=? AND t.work_id=? AND (s.status<>t.status OR (s.purged_at IS NULL)<>(t.purged_at IS NULL)) LIMIT 1`,
    )
    .bind(source, target)
    .first<{
      source_id: number;
      target_id: number;
      source_status: string;
      target_status: string;
      source_purged_at: string | null;
      target_purged_at: string | null;
    }>();
  if (conflict)
    throw new HttpError(
      409,
      `归档 #${conflict.source_id}（${conflict.source_purged_at ? "已清理" : conflict.source_status}）与 #${conflict.target_id}（${conflict.target_purged_at ? "已清理" : conflict.target_status}）文件相同但状态不同。请先在后台统一状态后再合并。`,
    );
}

async function requirePair(
  db: D1Database,
  table: "works" | "creators",
  source: number,
  target: number,
) {
  if (source === target) throw new HttpError(400, "不能合并到自身");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (?,?)`)
    .bind(source, target)
    .first<{ n: number }>();
  if (row?.n !== 2) throw new HttpError(404, "合并来源或目标不存在");
}
function audit(
  db: D1Database,
  actor: ArchiveUser,
  event: string,
  detail: Record<string, unknown>,
) {
  return db
    .prepare(
      `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,?,?)`,
    )
    .bind(actor.id, actor.email, event, JSON.stringify(detail));
}

async function assertMergeCover(db: D1Database, target: number) {
  if (!await db.prepare("SELECT 1 FROM work_media_assets WHERE work_id=? AND role='cover'").bind(target).first())
    throw new HttpError(409, "目标作品缺少封面，请先指定封面再合并");
}
