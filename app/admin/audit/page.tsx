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
        subtitle="按操作者或条目核查资料、评论与讨论的编辑历史及授权记录。"
      />

      <DailyAuditReportPane {...dailyReports} />

      <Pane heading="系统审计日志">
        <div className="grid min-w-0 gap-5">
          <form
            key={JSON.stringify([query, eventType, targetType, targetId])}
            action="/admin/audit"
            className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]"
            aria-label="系统审计日志筛选"
            method="get"
          >
            <Label className="admin-field">
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
            <div className="admin-filter-actions sm:col-span-2 xl:col-span-4">
              <Button type="submit">应用筛选</Button>
              {query || eventType || targetType || targetId || logId ? (
                <Link className={buttonVariants({ variant: "ghost" })} to="/admin/audit">
                  清除
                </Link>
              ) : null}
            </div>
          </form>
          <div className="admin-list-meta">
            <span>
              {logId ? `日志 #${logId} · ` : ""}
              共 {auditResult.total.toLocaleString("zh-CN")} 条系统日志
            </span>
            <span>每页 {PAGE_SIZE} 条</span>
          </div>

          {auditResult.items.length > 0 ? (
            <ol className="min-w-0 divide-y divide-border border-t border-border">
              {auditResult.items.map((log) => (
                <li key={log.id} id={`audit-log-${log.id}`} className="grid min-w-0 scroll-mt-6 gap-4 py-5 last:pb-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
                  <div className="grid min-w-0 content-start gap-3">
                    <div className="grid min-w-0 gap-1">
                      <h3 className="m-0 wrap-anywhere font-mono text-sm font-semibold text-primary">{log.eventType}</h3>
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span className="font-mono">#{log.id}</span>
                        <span>{formatDate(log.createdAt)}</span>
                      </p>
                    </div>
                    <div className="min-w-0 wrap-anywhere text-sm">
                      <p className="mb-1 text-xs text-muted">操作者</p>
                      <p className="font-medium">
                        {String(auditRecord(auditRecord(log.detail)?.actor)?.displayName ?? log.actorName ?? log.email ?? "系统")}
                        {log.userId ? <span className="ml-2 font-mono text-xs text-muted">#{log.userId}</span> : null}
                      </p>
                      {log.email ? <p className="mt-1 text-xs text-muted">{log.email}</p> : null}
                    </div>
                  </div>
                  <AuditDetail detail={log.detail} />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="暂无系统审计日志。" />
          )}
          <PaginationLinks
            className="my-0"
            basePath="/admin/audit"
            page={page}
            pageSize={PAGE_SIZE}
            total={auditResult.total}
            params={{ q: query || undefined, action: eventType || undefined, targetType: targetType || undefined, targetId: targetId || undefined, logId: logId ? String(logId) : undefined }}
          />
        </div>
      </Pane>

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
                      <span className="admin-cell-meta whitespace-pre-wrap wrap-anywhere">{event.reason}</span>
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
  return <div className="grid min-w-0 content-start gap-3">
    {targets.length ? <ul className="grid gap-2 text-sm">
      {targets.map((target) => <li className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1" key={`${target.type}:${target.id}`}>
        <Link className="min-w-0 wrap-anywhere text-primary hover:underline" to={entityAuditTargetHref(target)}>
          {AUDIT_TARGET_LABELS[target.type]} {target.name ?? ""} <span className="font-mono">#{target.id}</span>
        </Link>
        <Link className="shrink-0 text-xs text-muted hover:underline" to={`/admin/audit?targetType=${target.type}&targetId=${encodeURIComponent(String(target.id))}`}>编辑历史</Link>
      </li>)}
    </ul> : null}
    {!hasSnapshots && targets.length ?
      <p className="text-sm text-muted">此记录没有完整前后快照，无法还原全部字段修改。</p> : null}
    <details className="admin-details">
      <summary>{hasSnapshots ? `修改详情 · ${changes.length} 个字段` : "审计详情"}</summary>
      <div className="mt-4 grid min-w-0 gap-4">
        {authorization ? <dl className="grid gap-3 rounded-md bg-muted/10 p-3 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs text-muted">操作时角色</dt><dd className="mt-1 wrap-anywhere">{Array.isArray(actor?.roleNames) ? actor.roleNames.join("、") || "无角色" : "未记录"}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted">授权依据</dt><dd className="mt-1 wrap-anywhere">{authorization.basis === "content_author" ? "本人内容编辑" : authorization.basis === "work_maintainer" ? "作品维护者身份" : permissionLabel ?? "未记录"}</dd></div>
          {data?.source ? <div className="min-w-0"><dt className="text-xs text-muted">操作入口</dt><dd className="mt-1">{data.source === "admin" ? "后台" : data.source === "owned" ? "本人维护" : "前台"}</dd></div> : null}
        </dl> : null}
        {hasSnapshots ? (changes.length ? <ul className="grid min-w-0 gap-4">
          {changes.map((change, index) => <li className="min-w-0 rounded-md border border-border p-3" key={`${change.field}:${index}`}>
            <h4 className="mb-3 wrap-anywhere text-sm font-semibold">{change.field}</h4>
            <dl className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0"><dt className="mb-2 text-xs text-muted">修改前</dt><dd><pre className="whitespace-pre-wrap wrap-anywhere rounded bg-muted/10 p-3 font-mono text-xs leading-relaxed">{formatDetail(change.before)}</pre></dd></div>
              <div className="min-w-0"><dt className="mb-2 text-xs text-muted">修改后</dt><dd><pre className="whitespace-pre-wrap wrap-anywhere rounded bg-primary/5 p-3 font-mono text-xs leading-relaxed">{formatDetail(change.after)}</pre></dd></div>
            </dl>
          </li>)}
        </ul> : <p className="text-sm text-muted">未检测到字段变化。</p>) : null}
        <details className="admin-details"><summary>原始审计记录</summary>
          <pre className="mt-3 min-w-0 whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-muted/10 p-3 font-mono text-xs leading-relaxed">{formatDetail(detail)}</pre>
        </details>
      </div>
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
