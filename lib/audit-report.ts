import { AUDIT_TARGET_LABELS, auditRecord, entityAuditChanges, entityAuditEditedTargets, type EntityAuditTarget } from "./entity-audit";

const MAX_FINDINGS = 200;
const MAX_REFERENCES = 20;

export type AuditReportLog = {
  id: number;
  user_id: number | null;
  actor_name: string | null;
  event_type: string;
  detail_json: string | null;
};
export type AuditReportFinding = {
  kind: "destructive" | "cleared" | "links" | "authorization" | "volume" | "repeated" | "coverage";
  message: string;
  actorUserId: number | null;
  actorName: string;
  logIds: number[];
  targets: EntityAuditTarget[];
};
export type DailyAuditSummary = {
  version: 1 | 2;
  reportDate: string;
  windowStart: string;
  windowEnd: string;
  totalLogs: number;
  sourceMaxLogId: number;
  scannedLogs: number;
  entityEdits: number;
  completeSnapshots: number;
  incompleteEdits: number;
  changedFields: number;
  authorizationChanges: number;
  targetCounts: Record<EntityAuditTarget["type"], number>;
  actors: { userId: number | null; name: string; edits: number; targets: number }[];
  findings: AuditReportFinding[];
  findingCounts: Partial<Record<AuditReportFinding["kind"], number>>;
  omittedFindings: number;
};
export type DailyAuditReport = {
  reportDate: string;
  status: "complete" | "incomplete" | "failed";
  generatedAt: string;
  summary: DailyAuditSummary | null;
};

// Hong Kong has a fixed UTC+08:00 offset for the dates covered by these reports.
export function previousAuditDate(time = Date.now()): string {
  return new Date(time + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
}
export function auditReportWindow(reportDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("Invalid audit report date");
  const midnight = new Date(`${reportDate}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(midnight) || new Date(midnight + 8 * 3600_000).toISOString().slice(0, 10) !== reportDate)
    throw new Error("Invalid audit report date");
  const sqlTime = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
  return { start: sqlTime(midnight), end: sqlTime(midnight + 86400_000) };
}

type EditGroup = { count: number; logIds: number[]; userId: number | null; name: string; targets: Map<string, EntityAuditTarget> };

export class DailyAuditAnalyzer {
  readonly summary: DailyAuditSummary;
  private actors = new Map<string, EditGroup>();
  private repeated = new Map<string, EditGroup>();
  private targetIds = new Set<string>();

  constructor(reportDate: string, totalLogs: number, sourceMaxLogId: number) {
    const window = auditReportWindow(reportDate);
    this.summary = { version: 2, reportDate, windowStart: window.start, windowEnd: window.end, totalLogs, sourceMaxLogId,
      scannedLogs: 0, entityEdits: 0, completeSnapshots: 0, incompleteEdits: 0, changedFields: 0,
      authorizationChanges: 0, targetCounts: Object.fromEntries(Object.keys(AUDIT_TARGET_LABELS).map((type) => [type, 0])) as DailyAuditSummary["targetCounts"],
      actors: [], findings: [], findingCounts: {}, omittedFindings: 0 };
  }

  consume(log: AuditReportLog) {
    this.summary.scannedLogs++;
    let detail: unknown;
    try { detail = JSON.parse(log.detail_json ?? "null"); } catch { detail = null; }
    const data = auditRecord(detail);
    // Applying for authority or rejecting an application does not grant it and
    // does not edit the requested entity.
    if (/^(?:role|work_maintainer)_request_(?:created|rejected|withdrawn|cancelled)$/.test(log.event_type)) return;
    const actor = auditRecord(data?.actor);
    const historicalId = actor?.userId;
    const userId = typeof historicalId === "number" && Number.isSafeInteger(historicalId) && historicalId > 0 ? historicalId : log.user_id;
    const name = String(actor?.displayName ?? log.actor_name ?? (userId ? `用户 #${userId}` : "系统／未记录")).slice(0, 200);
    const targets = [...new Map(entityAuditEditedTargets(detail).map((target) => [`${target.type}:${target.id}`, target])).values()];
    const reference = { actorUserId: userId, actorName: name, logIds: [log.id], targets: targets.slice(0, 10).map(shortTarget) };
    if (/^(?:role_(?:created|updated|permissions_updated)|user_role_(?:assigned|removed)|user_permission_updated)$/.test(log.event_type)) {
      this.summary.authorizationChanges++;
      this.find({ ...reference, kind: "authorization", message: "账户角色或权限发生调整，请核查是否为预期授权。" });
    }
    const isEntityEdit = targets.length > 0 || data?.auditVersion === 1
      || /(?:work|creator|character|classification|category|tag|relation|comment|forum|genre).*(?:update|edit|delete|merge|create|commit|change)/.test(log.event_type);
    if (!isEntityEdit) return;
    this.summary.entityEdits++;
    const actorKey = userId === null ? `unknown:${name}` : String(userId);
    let group = this.actors.get(actorKey);
    if (!group) { group = { count: 0, logIds: [], userId, name, targets: new Map() }; this.actors.set(actorKey, group); }
    group.count++;
    if (group.logIds.length < MAX_REFERENCES) group.logIds.push(log.id);
    for (const target of targets) {
      const key = `${target.type}:${target.id}`;
      group.targets.set(key, shortTarget(target));
      if (!this.targetIds.has(key)) { this.targetIds.add(key); this.summary.targetCounts[target.type]++; }
      const repeatKey = `${actorKey}:${key}`;
      let repeated = this.repeated.get(repeatKey);
      if (!repeated) {
        repeated = { count: 0, logIds: [], userId, name, targets: new Map([[key, shortTarget(target)]]) };
        this.repeated.set(repeatKey, repeated);
      }
      repeated.count++;
      if (repeated.logIds.length < MAX_REFERENCES) repeated.logIds.push(log.id);
    }
    const authorization = auditRecord(data?.authorization);
    const hasSnapshots = data && Object.hasOwn(data, "before") && Object.hasOwn(data, "after");
    const hasIdentity = typeof historicalId === "number" && Number.isSafeInteger(historicalId) && historicalId > 0
      && actor && typeof actor.displayName === "string" && Array.isArray(actor.roleKeys);
    // The first public-creator writer stored the exact permission and grant
    // snapshot without a basis field. Interpret only that known historical
    // format; never reconstruct authorization from current account data.
    const permissionBased = authorization?.basis === "permission" || (authorization?.basis === undefined && data?.auditVersion === 1
      && /^(?:creator_metadata_update|creator_avatar_update)$/.test(log.event_type)
      && (authorization?.permission === "creator.metadata.update_public" || authorization?.permission === "creator.metadata.update_any"));
    const hasAuthorization = authorization && (authorization.basis === "work_maintainer" || authorization.basis === "content_author"
      || (permissionBased && typeof authorization.permission === "string" && Array.isArray(authorization.permissionKeys)));
    const missing = [!hasSnapshots && "修改前后快照", !hasIdentity && "操作时身份／角色", !hasAuthorization && "操作时授权依据", !targets.length && "编辑目标"].filter(Boolean);
    if (missing.length) {
      this.summary.incompleteEdits++;
      this.find({ ...reference, kind: "coverage", message: `此编辑缺少${missing.join("、")}，无法充分核查。` });
    } else this.summary.completeSnapshots++;
    if (permissionBased && typeof authorization?.permission === "string"
      && Array.isArray(authorization.permissionKeys) && authorization.isBootstrapAdmin !== true
      && !authorization.permissionKeys.includes(authorization.permission)) {
      this.find({ ...reference, kind: "authorization", message: "操作要求的权限未出现在操作时有效权限快照中，请核查授权依据。" });
    }
    if (log.user_id !== null && userId !== log.user_id) {
      this.find({ ...reference, kind: "authorization", message: "日志的操作用户与操作时身份快照不一致，请核查审计记录。" });
    }
    const changes = hasSnapshots ? entityAuditChanges(data.before, data.after) : [];
    this.summary.changedFields += changes.length;
    if (/(?:delete|remove|merge)/i.test(String(data?.operation ?? "")) || /(?:deleted?|merged?|removed?)/.test(log.event_type)
      || changes.some((change) => change.field.endsWith("状态") && change.after === "deleted") || (hasSnapshots && data.before != null && data.after == null)) {
      this.find({ ...reference, kind: "destructive", message: "发生删除、移除、合并或条目删除状态变更，请复核受影响资料。" });
    }
    if (!hasSnapshots) return;
    const cleared = changes.filter((change) => /(?:名称|中文名|原名|标题|简介|正文|配图|别名|制作人员|登场角色|分类归属|来源链接|标签|封面|外部链接)/.test(change.field)
      && ((nonempty(change.before) && !nonempty(change.after))
        || (typeof change.before === "string" && change.before.length >= 80 && typeof change.after === "string" && change.after.length <= change.before.length * .2)));
    if (cleared.length) this.find({ ...reference, kind: "cleared", message: `资料清空或长文本缩减至少 80%：${cleared.slice(0, 5).map((change) => change.field).join("、")}`.slice(0, 1000) });
    const beforeHosts = urlHosts(data.before);
    const afterHosts = urlHosts(data.after);
    const addedHosts = [...afterHosts].filter((host) => !beforeHosts.has(host));
    if (addedHosts.length) this.find({ ...reference, kind: "links", message: `新增外链域名：${addedHosts.slice(0, 10).join("、")}。请核查来源及链接目的。`.slice(0, 1000) });
  }

  finish(): DailyAuditSummary {
    for (const group of this.actors.values()) {
      this.summary.actors.push({ userId: group.userId, name: group.name, edits: group.count, targets: group.targets.size });
      if (group.count >= 30 || group.targets.size >= 15) this.find({ kind: "volume",
        message: `同一操作者当日编辑 ${group.count} 次、涉及 ${group.targets.size} 个条目（阈值：30 次或 15 个条目）。`,
        actorUserId: group.userId, actorName: group.name, logIds: group.logIds, targets: [...group.targets.values()].slice(0, 10) });
    }
    for (const group of this.repeated.values()) if (group.count >= 5) this.find({ kind: "repeated",
      message: `同一操作者当日改写此条目 ${group.count} 次（阈值：5 次），请核查编辑过程。`,
      actorUserId: group.userId, actorName: group.name, logIds: group.logIds, targets: [...group.targets.values()] });
    this.summary.actors.sort((left, right) => right.edits - left.edits);
    this.summary.actors = this.summary.actors.slice(0, 100);
    return this.summary;
  }

  private find(finding: AuditReportFinding) {
    this.summary.findingCounts[finding.kind] = (this.summary.findingCounts[finding.kind] ?? 0) + 1;
    if (this.summary.findings.length < MAX_FINDINGS) this.summary.findings.push(finding);
    else this.summary.omittedFindings++;
  }
}

function shortTarget(target: EntityAuditTarget): EntityAuditTarget {
  return { ...target, name: target.name?.slice(0, 200) ?? null };
}
function nonempty(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : value != null;
}
function urlHosts(value: unknown): Set<string> {
  const hosts = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") for (const match of item.matchAll(/https?:\/\/[^\s<>"'[\]{}]+/gi)) {
      try { hosts.add(new URL(match[0]).hostname.toLowerCase()); } catch { /* Text can contain an incomplete URL. */ }
    }
    else if (Array.isArray(item)) item.forEach(visit);
    else if (auditRecord(item)) Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return hosts;
}
