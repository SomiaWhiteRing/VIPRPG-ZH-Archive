import { getD1 } from './d1';
import { auditedEntityBatch } from './entity-audit';
import { userPermissionSql } from '@/app/.server/auth/permission-sql';
import type { AppRuntime } from '@/app/.server/runtime';
import type { ArchiveUser } from '@/lib/dto/db/user-access';
import type { MaintainerApplication, MaintainerRequestStatus, MaintainerUser } from '@/lib/work-maintainers';
import { hasPermission } from '@/lib/authz/permissions';
import { HttpError } from '@/lib/http';
import { normalizeRejectionReason } from '@/lib/inbox';

// All expressions are trusted server SQL; request values are bound parameters.
export function workMaintainerRecipientSql(work: string, actor: string) {
  return `(${userPermissionSql(actor, 'work.update_own')} AND EXISTS
    (SELECT 1 FROM work_uploaders manager JOIN works managed_work ON managed_work.id=manager.work_id
      WHERE manager.work_id=${work} AND manager.user_id=${actor} AND managed_work.status<>'deleted'))`;
}

export function workMaintainerManagerSql(work: string, actor: string) {
  return `(${userPermissionSql(actor, 'work.maintainer.manage_any')} OR
    ${workMaintainerRecipientSql(work, actor)})`;
}

const eligibleRecipientsSql = `SELECT u.id,u.display_name AS displayName,u.avatar_blob_sha256 AS avatarBlobSha256
  FROM work_uploaders wu JOIN users u ON u.id=wu.user_id
  WHERE wu.work_id=? AND ${userPermissionSql('u.id', 'work.update_own')} ORDER BY u.id`;

export async function canManageWorkMaintainers(runtime: AppRuntime, workId: number, actor: ArchiveUser) {
  return !!await getD1(runtime).prepare(`SELECT 1 FROM works w WHERE w.id=?
    AND ${workMaintainerManagerSql('w.id', '?')}`)
    .bind(workId, actor.id, actor.id, actor.id).first();
}

export async function canReviewWorkMaintainerRequests(runtime: AppRuntime, actor: ArchiveUser) {
  if (hasPermission(actor, 'work.maintainer.manage_any')) return true;
  if (!hasPermission(actor, 'work.update_own')) return false;
  return !!await getD1(runtime).prepare(`SELECT 1 FROM work_uploaders wu JOIN works w ON w.id=wu.work_id
    WHERE wu.user_id=? AND w.status<>'deleted' LIMIT 1`).bind(actor.id).first();
}

export async function listPublicWorkMaintainers(runtime: AppRuntime, workId: number): Promise<MaintainerUser[]> {
  return (await getD1(runtime).prepare(`SELECT u.id,u.display_name AS displayName,
    CASE WHEN u.status='active' THEN u.avatar_blob_sha256 ELSE NULL END AS avatarBlobSha256
    FROM work_uploaders wu JOIN users u ON u.id=wu.user_id WHERE wu.work_id=? ORDER BY u.id`)
    .bind(workId).all<MaintainerUser>()).results;
}

export async function getMaintainerApplication(runtime: AppRuntime, workId: number, actor: ArchiveUser): Promise<MaintainerApplication> {
  const db = getD1(runtime);
  const work = await db.prepare(`SELECT status FROM works WHERE id=?`).bind(workId).first<{ status: string }>();
  if (!work || work.status !== 'published') throw new HttpError(404, '作品不存在或不可申请。');
  const recipients = (await db.prepare(eligibleRecipientsSql).bind(workId).all<MaintainerUser>()).results;
  const request = await db.prepare(`SELECT r.id,r.status,i.id AS inboxItemId,r.resolved_at
    FROM work_maintainer_requests r JOIN inbox_items i ON i.work_maintainer_request_id=r.id
    WHERE r.work_id=? AND r.applicant_user_id=? ORDER BY r.id DESC LIMIT 1`)
    .bind(workId, actor.id).first<{ id: number; status: MaintainerRequestStatus; inboxItemId: number; resolved_at: string | null }>();
  const limits = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM work_maintainer_requests WHERE applicant_user_id=? AND created_at>=datetime('now','-1 day')) AS recent,
    (SELECT COUNT(*) FROM work_maintainer_requests WHERE applicant_user_id=? AND status='pending') AS pending,
    EXISTS(SELECT 1 FROM work_maintainer_requests WHERE work_id=? AND applicant_user_id=?
      AND COALESCE(resolved_at,created_at)>datetime('now','-30 days')) AS cooling,
    EXISTS(SELECT 1 FROM users WHERE id=? AND created_at<=datetime('now','-1 day') AND email_verified_at IS NOT NULL) AS established,
    EXISTS(SELECT 1 FROM work_uploaders WHERE work_id=? AND user_id=?) AS member`)
    .bind(actor.id, actor.id, workId, actor.id, actor.id, workId, actor.id)
    .first<{ recent: number; pending: number; cooling: number; established: number; member: number }>();
  const unavailableReason = !hasPermission(actor, 'work.update_own') || actor.status !== 'active' ? '当前账户没有作品维护资格。'
    : limits?.member || hasPermission(actor, 'work.metadata.update_any') || hasPermission(actor, 'work.distribution.update_any') ? '你已拥有这部作品的编辑权限。'
    : !recipients.length ? '这部作品暂时没有可以接收申请的维护者。'
    : request?.status === 'pending' ? '申请正在等待维护者处理。'
    : !limits?.established ? '邮箱验证完成且注册满一天后，可以申请维护。'
    : limits.cooling ? '这部作品暂时不能再次申请维护。'
    : limits.recent >= 3 || limits.pending >= 5 ? '申请过于频繁，请稍后再试。' : null;
  return { recipients, request: request ? { id: request.id, status: request.status, inboxItemId: request.inboxItemId } : null,
    canApply: unavailableReason === null, unavailableReason };
}

export async function requestWorkMaintainer(runtime: AppRuntime, actor: ArchiveUser, workId: number, recipientIds: number[]) {
  const state = await getMaintainerApplication(runtime, workId, actor);
  if (state.request?.status === 'pending') return state;
  if (!state.canApply) throw new HttpError(429, state.unavailableReason ?? '暂时无法申请。');
  const recipientKey = JSON.stringify([...new Set(recipientIds)].sort((a, b) => a - b));
  if (recipientKey !== JSON.stringify(state.recipients.map((user) => user.id)))
    throw new HttpError(409, '接收申请的维护者已变化，请重新打开申请窗口。');
  const db = getD1(runtime);
  const key = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO work_maintainer_requests(work_id,applicant_user_id,submission_key)
      SELECT w.id,u.id,? FROM works w JOIN users u ON u.id=? WHERE w.id=? AND w.status='published'
        AND u.email_verified_at IS NOT NULL AND u.created_at<=datetime('now','-1 day')
        AND ${userPermissionSql('u.id', 'work.update_own')}
        AND NOT ${userPermissionSql('u.id', ['work.metadata.update_any', 'work.distribution.update_any'])}
        AND NOT EXISTS(SELECT 1 FROM work_uploaders WHERE work_id=w.id AND user_id=u.id)
        AND NOT EXISTS(SELECT 1 FROM work_maintainer_requests WHERE work_id=w.id AND applicant_user_id=u.id
          AND (status='pending' OR COALESCE(resolved_at,created_at)>datetime('now','-30 days')))
        AND (SELECT COUNT(*) FROM work_maintainer_requests WHERE applicant_user_id=u.id AND created_at>=datetime('now','-1 day'))<3
        AND (SELECT COUNT(*) FROM work_maintainer_requests WHERE applicant_user_id=u.id AND status='pending')<5
        AND (SELECT json_group_array(id) FROM (${eligibleRecipientsSql}))=? AND ?<>'[]'
      ON CONFLICT DO NOTHING`).bind(key, actor.id, workId, workId, recipientKey, recipientKey),
    db.prepare(`INSERT INTO inbox_items(type,status,sender_user_id,recipient_user_id,target_user_id,title,body,event_key,work_maintainer_request_id,metadata_json)
      SELECT 'system_notice','pending',r.applicant_user_id,r.applicant_user_id,r.applicant_user_id,'作品维护申请','',
        'work-maintainer-request:'||r.id,r.id,json_object('workTitle',COALESCE(NULLIF(w.chinese_title,''),w.original_title))
      FROM work_maintainer_requests r JOIN works w ON w.id=r.work_id WHERE r.submission_key=?`).bind(key),
    db.prepare(`INSERT INTO auth_audit_logs(user_id,event_type,detail_json)
      SELECT applicant_user_id,'work_maintainer_request_created',json_object('workId',work_id,'requestId',id)
      FROM work_maintainer_requests WHERE submission_key=?`).bind(key),
    // Show every request directly, but quietly deliver repeats across the recipient's works.
    db.prepare(`INSERT INTO inbox_item_reads(item_id,user_id,read_at)
      SELECT i.id,wu.user_id,CURRENT_TIMESTAMP FROM work_maintainer_requests r
      JOIN inbox_items i ON i.work_maintainer_request_id=r.id
      JOIN work_uploaders wu ON wu.work_id=r.work_id
      WHERE r.submission_key=? AND ${userPermissionSql('wu.user_id', 'work.update_own')}
        AND EXISTS(SELECT 1 FROM work_uploaders old_owner
          JOIN work_maintainer_requests old_request ON old_request.work_id=old_owner.work_id
          JOIN works old_work ON old_work.id=old_request.work_id AND old_work.status<>'deleted'
          JOIN inbox_items old ON old.work_maintainer_request_id=old_request.id
          WHERE old_owner.user_id=wu.user_id AND old.id<i.id AND old_request.applicant_user_id<>wu.user_id
            AND (old.created_at>=datetime('now','-1 day') OR NOT EXISTS
              (SELECT 1 FROM inbox_item_reads rd WHERE rd.item_id=old.id AND rd.user_id=wu.user_id)))`).bind(key),
  ]);
  const result = await getMaintainerApplication(runtime, workId, actor);
  if (!result.request || (result.request.status !== 'pending' && !await db.prepare('SELECT 1 FROM work_maintainer_requests WHERE submission_key=?').bind(key).first()))
    throw new HttpError(409, '申请条件已变化，请刷新后重试。');
  return result;
}

function maintainerSnapshot(workId: number, requestId: number | null = null) {
  return { sql: `SELECT json_object('maintainers',json((SELECT json_group_array(user_id) FROM
    (SELECT user_id FROM work_uploaders WHERE work_id=? ORDER BY user_id))),
    'request',json((SELECT json_object('id',id,'status',status) FROM work_maintainer_requests WHERE id=?)))`, binds: [workId, requestId] };
}

function grantStatement(db: D1Database, workId: number, userId: number, condition: string, binds: (string | number)[]) {
  return db.prepare(`INSERT OR IGNORE INTO work_uploaders(work_id,user_id)
    SELECT ?,u.id FROM users u WHERE u.id=? AND ${userPermissionSql('u.id', 'work.update_own')} AND ${condition}`)
    .bind(workId, userId, ...binds);
}

export async function addWorkMaintainer(runtime: AppRuntime, actor: ArchiveUser, workId: number, userId: number) {
  if (!await canManageWorkMaintainers(runtime, workId, actor)) throw new HttpError(403, '没有添加此作品维护者的权限。');
  const db = getD1(runtime);
  const key = crypto.randomUUID();
  const result = await auditedEntityBatch(db, [
    grantStatement(db, workId, userId, `EXISTS(SELECT 1 FROM works w WHERE w.id=?
      AND ${workMaintainerManagerSql('w.id', '?')})`, [workId, actor.id, actor.id, actor.id]),
    db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key)
      SELECT 'system_notice',?,?, '已加入作品维护者','你已被加入作品《'||COALESCE(NULLIF(chinese_title,''),original_title)||'》的维护者，可从“我的上传”进入编辑。',?
      FROM works WHERE id=? AND changes()=1`).bind(actor.id, userId, `work-maintainer-added:${key}`, workId),
    db.prepare(`UPDATE work_maintainer_requests SET status='approved',resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,resolution_key=?
      WHERE work_id=? AND applicant_user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM inbox_items WHERE event_key=?)`).bind(actor.id, key, workId, userId, `work-maintainer-added:${key}`),
  ], { actor, eventType: 'work_maintainer_changed', targets: [{ type: 'work', id: workId }],
    snapshot: maintainerSnapshot(workId), permission: hasPermission(actor, 'work.maintainer.manage_any') ? 'work.maintainer.manage_any' : null,
    source: hasPermission(actor, 'work.maintainer.manage_any') ? 'admin' : 'owned', context: { userId, remove: false } });
  if (!result[0].meta.changes && !await db.prepare('SELECT 1 FROM work_uploaders WHERE work_id=? AND user_id=?').bind(workId, userId).first())
    throw new HttpError(409, '账户或维护权限已变化，请重新选择。');
}

export async function resolveWorkMaintainerRequest(runtime: AppRuntime, actor: ArchiveUser, itemId: number, decision: 'approve' | 'reject' | 'withdraw', rejectionReason?: unknown) {
  const db = getD1(runtime);
  const request = await db.prepare(`SELECT r.* FROM work_maintainer_requests r JOIN inbox_items i ON i.work_maintainer_request_id=r.id WHERE i.id=?`)
    .bind(itemId).first<{ id: number; work_id: number; applicant_user_id: number; status: MaintainerRequestStatus }>();
  if (!request) throw new HttpError(404, '申请不存在。');
  if (decision === 'withdraw' ? request.applicant_user_id !== actor.id : request.applicant_user_id === actor.id || !await canManageWorkMaintainers(runtime, request.work_id, actor))
    throw new HttpError(403, '没有处理此申请的权限。');
  const reason = decision === 'reject' ? normalizeRejectionReason(rejectionReason) : null;
  const key = crypto.randomUUID();
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'withdrawn';
  const actorGuard = decision === 'withdraw' ? `applicant_user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')`
    : `applicant_user_id<>? AND EXISTS(SELECT 1 FROM works w WHERE w.id=work_id AND w.status<>'deleted'
        AND ${workMaintainerManagerSql('w.id', '?')})`;
  const actorBinds = decision === 'withdraw' ? [actor.id, actor.id] : [actor.id, actor.id, actor.id, actor.id];
  const statements = [db.prepare(`UPDATE work_maintainer_requests SET status=?,resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,resolution_key=?
    WHERE id=? AND status='pending' AND ${actorGuard}
      ${decision === 'approve' ? `AND ${userPermissionSql('applicant_user_id', 'work.update_own')}
        AND NOT EXISTS(SELECT 1 FROM work_uploaders WHERE work_id=work_maintainer_requests.work_id AND user_id=applicant_user_id)` : ''}`)
    .bind(status, actor.id, key, request.id, ...actorBinds)];
  if (decision === 'approve') statements.push(grantStatement(db, request.work_id, request.applicant_user_id,
    `EXISTS(SELECT 1 FROM work_maintainer_requests WHERE id=? AND resolution_key=?)`, [request.id, key]));
  if (decision === 'reject') statements.push(db.prepare(`UPDATE inbox_items
    SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.rejectionReason',?)
    WHERE work_maintainer_request_id=? AND EXISTS(SELECT 1 FROM work_maintainer_requests WHERE id=? AND resolution_key=?)`)
    .bind(reason, request.id, request.id, key));
  if (decision !== 'withdraw') statements.push(db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key,metadata_json)
    SELECT 'system_notice',?,r.applicant_user_id,?, '作品《'||COALESCE(NULLIF(w.chinese_title,''),w.original_title)||'》的维护申请'||?,?,json_object('rejectionReason',?)
    FROM work_maintainer_requests r JOIN works w ON w.id=r.work_id WHERE r.id=? AND r.resolution_key=?`)
    .bind(actor.id, decision === 'approve' ? '维护申请已通过' : '维护申请未通过', decision === 'approve' ? '已通过，可从“我的上传”进入编辑。' : '未通过。',
      `work-maintainer-result:${request.id}`, reason, request.id, key));
  statements.push(db.prepare(`INSERT INTO inbox_item_reads(item_id,user_id,read_at)
    SELECT ?,?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM work_maintainer_requests WHERE id=? AND resolution_key=?)
    ON CONFLICT(item_id,user_id) DO NOTHING`).bind(itemId, actor.id, request.id, key));
  const result = await auditedEntityBatch(db, statements, { actor, eventType: 'work_maintainer_request_resolved',
    targets: [{ type: 'work', id: request.work_id }], snapshot: maintainerSnapshot(request.work_id, request.id),
    permission: decision === 'withdraw' ? 'work.update_own' : hasPermission(actor, 'work.maintainer.manage_any') ? 'work.maintainer.manage_any' : null,
    source: decision === 'withdraw' ? 'public' : hasPermission(actor, 'work.maintainer.manage_any') ? 'admin' : 'owned',
    context: { requestId: request.id, decision, ...(reason ? { rejectionReason: reason } : {}) } });
  if (!result[0].meta.changes) throw new HttpError(409, '申请已被处理，或账户及维护权限已变化，请刷新后查看。');
}

export async function searchWorkMaintainerCandidates(runtime: AppRuntime, actor: ArchiveUser, workId: number, query: string) {
  if (!await canManageWorkMaintainers(runtime, workId, actor)) throw new HttpError(403, '没有管理此作品维护者的权限。');
  const term = query.trim();
  if (!term) return [];
  if (term.length > 80) throw new HttpError(400, '搜索内容过长。');
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  return (await getD1(runtime).prepare(`SELECT u.id,u.display_name AS displayName,u.avatar_blob_sha256 AS avatarBlobSha256
    FROM users u WHERE ${userPermissionSql('u.id', 'work.update_own')}
      AND NOT EXISTS(SELECT 1 FROM work_uploaders WHERE work_id=? AND user_id=u.id)
      AND (u.display_name LIKE ? ESCAPE '\\' OR u.id=?)
    ORDER BY CASE WHEN u.display_name=? THEN 0 ELSE 1 END,u.display_name COLLATE NOCASE,u.id LIMIT 20`)
    .bind(workId, pattern, /^[1-9]\d*$/.test(term) && Number.isSafeInteger(Number(term)) ? Number(term) : -1, term).all<MaintainerUser>()).results;
}

export async function removeWorkMaintainer(runtime: AppRuntime, actor: ArchiveUser, workId: number, userId: number) {
  if (!hasPermission(actor, 'work.maintainer.manage_any')) throw new HttpError(403, '没有移除作品维护者的权限。');
  const db = getD1(runtime);
  await auditedEntityBatch(db, [db.prepare(`DELETE FROM work_uploaders WHERE work_id=? AND user_id=?
    AND ${userPermissionSql('?', 'work.maintainer.manage_any')}`).bind(workId, userId, actor.id)],
  { actor, eventType: 'work_maintainer_changed', targets: [{ type: 'work', id: workId }],
    snapshot: maintainerSnapshot(workId), permission: 'work.maintainer.manage_any', source: 'admin', context: { userId, remove: true } });
}
