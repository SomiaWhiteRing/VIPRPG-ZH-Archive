import { requirePagePermission } from "@/app/.server/auth/authorize";
import {
  listAdminRoleEvents,
  searchAdminAuditLogs,
} from "@/app/.server/db/admin-audit";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { SelectField } from "@/app/components/ui/select";
import { AUDIT_TARGET_LABELS, auditRecord, entityAuditChanges, entityAuditTargets, entityAuditTargetHref } from "@/lib/entity-audit";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { formatDate } from "@/lib/format";
import { listDailyAuditReports } from "@/app/.server/db/audit-reports";
import { DailyAuditReportPane } from "@/app/admin/audit/daily-report";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(runtime, "/admin/audit", "audit.read");
  const params = await searchParams;
  const query = searchParam(params.q);
  const eventType = searchParam(params.action);
  const rawTargetType = searchParam(params.targetType);
  const targetType = Object.hasOwn(AUDIT_TARGET_LABELS, rawTargetType) ? rawTargetType : "";
  const targetId = searchParam(params.targetId);
  const logIdText = searchParam(params.logId);
  const logId = /^\d+$/.test(logIdText) && Number.isSafeInteger(Number(logIdText)) && Number(logIdText) > 0 ? Number(logIdText) : undefined;
  const reportDate = searchParam(params.reportDate);
  const page = parseAdminPage(params.page);
  const [auditResult, roleEvents, dailyReports] = await Promise.all([
    searchAdminAuditLogs(runtime, {
      query,
      eventType,
      targetType,
      targetId,
      logId,
      page,
      pageSize: PAGE_SIZE,
    }),
    listAdminRoleEvents(runtime, 100),
    listDailyAuditReports(runtime, reportDate),
  ]);

  return { query, eventType, targetType, targetId, logId, page, auditResult, roleEvents, dailyReports };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["审计日志", "控制台"], page: loaderData?.page }, error);

export default function AdminAuditPage() {
  const { query, eventType, targetType, targetId, logId, page, auditResult, roleEvents, dailyReports } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="审计日志"
        subtitle="按操作者或条目核查资料修改、关联整理与授权记录。"
      />

      <DailyAuditReportPane {...dailyReports} />

      <form
        key={JSON.stringify([query, eventType, targetType, targetId])}
        action="/admin/audit"
        className="admin-filter-row"
        method="get"
      >
        <Label className="admin-field admin-field-search">
          操作者
          <Input
            defaultValue={query}
            name="q"
            placeholder="当前或操作时名称、邮箱、用户 ID"
          />
        </Label>
        <Label className="admin-field">
          动作
          <Input
            defaultValue={eventType}
            name="action"
            placeholder="事件类型"
          />
        </Label>
        <Label className="admin-field">
          条目类型
          <SelectField aria-label="条目类型" name="targetType" defaultValue={targetType}
            options={[{ value: "", label: "全部类型" }, ...Object.entries(AUDIT_TARGET_LABELS).map(([value, label]) => ({ value, label }))]} />
        </Label>
        <Label className="admin-field">
          条目 ID／标签名
          <Input name="targetId" defaultValue={targetId} placeholder="精确 ID 或标签名称" />
        </Label>
        <Button type="submit">应用</Button>
        {query || eventType || targetType || targetId || logId ? (
          <Link
            className={buttonVariants({ variant: "ghost" })}
            to="/admin/audit"
          >
            清除
          </Link>
        ) : null}
      </form>
      <div className="admin-list-meta">
        <span>
          {logId ? `日志 #${logId} · ` : ""}
          共 {auditResult.total.toLocaleString("zh-CN")} 条系统日志
        </span>
        <span>每页 {PAGE_SIZE} 条</span>
      </div>

      <details className="admin-panel admin-details">
        <summary>用户角色事件 · {roleEvents.length} 条</summary>
        {roleEvents.length > 0 ? (
          <TableWrap compact label="用户角色事件" minWidth={980}>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>目标用户</th>
                <th>变更</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {roleEvents.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.createdAt)}</td>
                  <td>
                    {event.actorName ?? "系统"}
                    {event.actorUserId ? (
                      <span className="admin-cell-meta font-mono">
                        #{event.actorUserId}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {event.targetName ?? "未知用户"}
                    <span className="admin-cell-meta font-mono">
                      #{event.targetUserId}
                    </span>
                  </td>
                  <td>
                    {event.action === "assigned" ? "分配" : "移除"}{" "}
                    {event.role.name}
                    {event.reason ? (
                      <span className="whitespace-pre-wrap wrap-anywhere text-sm text-muted">{event.reason}</span>
                    ) : null}
                  </td>
                  <td>
                    {event.sourceInboxItemId ? (
                      <span className="font-mono text-sm text-primary">
                        提醒 #{event.sourceInboxItemId}
                      </span>
                    ) : (
                      "直接调整"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无用户角色事件。" />
        )}
      </details>

      <Pane heading="系统审计日志">
        {auditResult.items.length > 0 ? (
          <TableWrap compact label="系统审计日志" minWidth={980}>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>操作者</th>
                <th>条目与修改</th>
              </tr>
            </thead>
            <tbody>
              {auditResult.items.map((log) => (
                <tr key={log.id} id={`audit-log-${log.id}`}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    <span className="font-mono text-sm text-primary">
                      {log.eventType}
                    </span>
                    <span className="admin-cell-meta font-mono">
                      #{log.id}
                    </span>
                  </td>
                  <td>
                    {String(auditRecord(auditRecord(log.detail)?.actor)?.displayName ?? log.actorName ?? log.email ?? "系统")}
                    {log.userId ? (
                      <span className="admin-cell-meta font-mono">
                        #{log.userId}
                      </span>
                    ) : null}
                    {log.email ? (
                      <span className="admin-cell-meta">{log.email}</span>
                    ) : null}
                  </td>
                  <td>
                    <AuditDetail detail={log.detail} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无系统审计日志。" />
        )}
      </Pane>
      <PaginationLinks
        basePath="/admin/audit"
        page={page}
        pageSize={PAGE_SIZE}
        total={auditResult.total}
        params={{ q: query || undefined, action: eventType || undefined, targetType: targetType || undefined, targetId: targetId || undefined, logId: logId ? String(logId) : undefined }}
      />
    </main>
  );
}

function AuditDetail({ detail }: { detail: unknown }) {
  const data = auditRecord(detail);
  const targets = entityAuditTargets(detail);
  const hasSnapshots = data && Object.hasOwn(data, "before") && Object.hasOwn(data, "after");
  const changes = hasSnapshots ? entityAuditChanges(data.before, data.after) : [];
  const authorization = auditRecord(data?.authorization);
  const actor = auditRecord(data?.actor);
  const permission = typeof authorization?.permission === "string" ? authorization.permission : null;
  const permissionLabel = permission && Object.hasOwn(PERMISSIONS, permission)
    ? PERMISSIONS[permission as keyof typeof PERMISSIONS].label : permission;
  return <div className="grid min-w-80 gap-3">
    {targets.length ? <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {targets.map((target) => <li key={`${target.type}:${target.id}`}>
        <Link className="text-primary hover:underline" to={entityAuditTargetHref(target)}>
          {AUDIT_TARGET_LABELS[target.type]} {target.name ?? ""} <span className="font-mono">#{target.id}</span>
        </Link>{" "}
        <Link className="text-xs text-muted hover:underline" to={`/admin/audit?targetType=${target.type}&targetId=${encodeURIComponent(String(target.id))}`}>编辑历史</Link>
      </li>)}
    </ul> : null}
    {authorization ? <p className="text-sm text-muted">
      操作时角色：{Array.isArray(actor?.roleNames) ? actor.roleNames.join("、") || "无角色" : "未记录"}；
      授权依据：{authorization.basis === "work_maintainer" ? "作品维护者身份" : permissionLabel ?? "未记录"}
      {data?.source ? `；入口：${data.source === "admin" ? "后台" : data.source === "owned" ? "本人维护" : "前台"}` : ""}
    </p> : null}
    {hasSnapshots ? (changes.length ? <details className="admin-details">
      <summary>字段变化 · {changes.length} 项</summary>
      <TableWrap compact label="字段修改前后" minWidth={760}>
      <thead><tr><th>修改字段</th><th>修改前</th><th>修改后</th></tr></thead>
      <tbody>{changes.map((change, index) => <tr key={`${change.field}:${index}`}>
        <td className="wrap-anywhere text-xs">{change.field}</td>
        <td><pre className="max-w-lg whitespace-pre-wrap wrap-anywhere text-xs">{formatDetail(change.before)}</pre></td>
        <td><pre className="max-w-lg whitespace-pre-wrap wrap-anywhere text-xs">{formatDetail(change.after)}</pre></td>
      </tr>)}</tbody>
    </TableWrap></details> : <p className="text-sm text-muted">未检测到字段变化。</p>) : targets.length ?
      <p className="text-sm text-muted">此记录没有完整前后快照，无法还原全部字段修改。</p> : null}
    <details className="admin-details"><summary>原始审计记录</summary>
      <pre className="mt-2 max-w-3xl overflow-x-auto whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-muted/10 p-3 font-mono text-xs">{formatDetail(detail)}</pre>
    </details>
  </div>;
}

function formatDetail(value: unknown): string {
  if (value === undefined) return "（不存在）";
  if (value === null) return "（空）";

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
