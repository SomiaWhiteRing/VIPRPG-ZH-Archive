import { EmptyState } from "@/app/components/ui/empty-state";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { listAdminRoleEvents, searchAdminAuditLogs } from "@/lib/server/db/admin-audit";
import { AdminPagination, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("/admin/audit", "audit.read");
  const params = await searchParams;
  const query = searchParam(params.q);
  const eventType = searchParam(params.action);
  const page = parseAdminPage(params.page);
  const [auditResult, roleEvents] = await Promise.all([
    searchAdminAuditLogs({ query, eventType, page, pageSize: PAGE_SIZE }),
    listAdminRoleEvents(100),
  ]);

  return (
    <main>
      <PageHeader
        compact
        title="审计日志"
        subtitle="登录、版本维护与权限调整的审计日志。"
      />

      <form action="/admin/audit" className="flex flex-wrap items-end gap-2 border-b border-border pb-3" method="get">
        <Label className="grid min-w-52 flex-1 gap-1 text-xs font-semibold text-muted">操作者<Input defaultValue={query} name="q" placeholder="名称、邮箱或用户 ID" /></Label>
        <Label className="grid min-w-52 flex-1 gap-1 text-xs font-semibold text-muted">动作<Input defaultValue={eventType} name="action" placeholder="事件类型" /></Label>
        <Button type="submit">应用</Button>
        {query || eventType ? <Link className={buttonVariants({ variant: "ghost" })} href="/admin/audit">清除</Link> : null}
        <span className="pb-2 font-mono text-xs text-muted">共 {auditResult.total.toLocaleString("zh-CN")} 条系统日志</span>
      </form>

      <Pane heading="用户角色事件">
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
                      <span className="font-mono text-sm text-muted">#{event.actorUserId}</span>
                    ) : null}
                  </td>
                  <td>
                    {event.targetName ?? "未知用户"}
                    <span className="font-mono text-sm text-muted">#{event.targetUserId}</span>
                  </td>
                  <td>
                    {event.action === "assigned" ? "分配" : "移除"} {event.role.name}
                    {event.reason ? <span className="text-sm text-muted">{event.reason}</span> : null}
                  </td>
                  <td>
                    {event.sourceInboxItemId ? (
                      <span className="font-mono text-sm text-primary">提醒 #{event.sourceInboxItemId}</span>
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
      </Pane>

      <Pane heading="系统审计日志">
        {auditResult.items.length > 0 ? (
          <TableWrap compact label="系统审计日志" minWidth={980}>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>操作者</th>
                <th>上下文</th>
              </tr>
            </thead>
            <tbody>
              {auditResult.items.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>
                    <span className="font-mono text-sm text-primary">{log.eventType}</span>
                    <span className="font-mono text-sm text-muted">#{log.id}</span>
                  </td>
                  <td>
                    {log.actorName ?? log.email ?? "系统"}
                    {log.userId ? <span className="font-mono text-sm text-muted">#{log.userId}</span> : null}
                    {log.email ? <span className="text-sm text-muted">{log.email}</span> : null}
                  </td>
                  <td>
                    <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/10 p-3 font-mono text-sm text-xs grid gap-4">
                      {formatDetail(log.detail)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无系统审计日志。" />
        )}
      </Pane>
      <AdminPagination basePath="/admin/audit" page={page} pageSize={PAGE_SIZE} total={auditResult.total} params={{ q: query || undefined, action: eventType || undefined }} />
    </main>
  );
}

function formatDetail(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
