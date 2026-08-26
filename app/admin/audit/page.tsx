import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { listAdminAuditLogs, listAdminRoleEvents } from "@/lib/server/db/admin-audit";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const adminUser = await requirePagePermission("/admin/audit", "audit.read");
  const [auditLogs, roleEvents, unreadInboxCount] = await Promise.all([
    listAdminAuditLogs(200),
    listAdminRoleEvents(100),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        title="审计日志"
        subtitle="登录、版本维护与权限调整的审计日志。"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

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
                      <span className="font-mono text-sm text-primary">站内信 #{event.sourceInboxItemId}</span>
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
        {auditLogs.length > 0 ? (
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
              {auditLogs.map((log) => (
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
