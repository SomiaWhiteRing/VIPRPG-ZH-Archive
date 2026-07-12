import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireSuperAdminPageUser } from "@/lib/server/auth/guards";
import {
  listAdminAuditLogs,
  listAdminRoleEvents,
} from "@/lib/server/db/admin-audit";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const adminUser = await requireSuperAdminPageUser("/admin/audit");
  const [auditLogs, roleEvents, unreadInboxCount] = await Promise.all([
    listAdminAuditLogs(200),
    listAdminRoleEvents(100),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Super Admin Audit"
        title="审计日志"
        subtitle="登录、归档维护与权限调整的审计日志。"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <Pane heading="权限清单">
        <TableWrap compact label="权限清单" minWidth={760}>
            <thead>
              <tr>
                <th>能力</th>
                <th>普通用户</th>
                <th>上传者</th>
                <th>管理员</th>
                <th>超级管理员</th>
              </tr>
            </thead>
            <tbody>
              {permissionRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.user}</td>
                  <td>{row.uploader}</td>
                  <td>{row.admin}</td>
                  <td>{row.superAdmin}</td>
                </tr>
              ))}
            </tbody>
        </TableWrap>
      </Pane>

      <Pane heading="用户层级事件">
        {roleEvents.length > 0 ? (
          <TableWrap compact label="用户层级事件" minWidth={980}>
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
                        <span className="mono muted-line">#{event.actorUserId}</span>
                      ) : null}
                    </td>
                    <td>
                      {event.targetName ?? "未知用户"}
                      <span className="mono muted-line">#{event.targetUserId}</span>
                    </td>
                    <td>
                      {roleLabel(event.oldRole)} {"->"} {roleLabel(event.newRole)}
                      {event.reason ? (
                        <span className="muted-line">{event.reason}</span>
                      ) : null}
                    </td>
                    <td>
                      {event.sourceInboxItemId ? (
                        <span className="mono">站内信 #{event.sourceInboxItemId}</span>
                      ) : (
                        "直接调整"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无用户层级事件。" />
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
                      <span className="mono">{log.eventType}</span>
                      <span className="mono muted-line">#{log.id}</span>
                    </td>
                    <td>
                      {log.actorName ?? log.email ?? "系统"}
                      {log.userId ? (
                        <span className="mono muted-line">#{log.userId}</span>
                      ) : null}
                      {log.email ? <span className="muted-line">{log.email}</span> : null}
                    </td>
                    <td>
                      <pre className="code-block compact-code audit-detail">
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

const permissionRows = [
  {
    name: "上传与导入游戏",
    user: "否",
    uploader: "是",
    admin: "是",
    superAdmin: "是",
  },
  {
    name: "删除归档快照",
    user: "否",
    uploader: "仅自己上传",
    admin: "全部",
    superAdmin: "全部",
  },
  {
    name: "查看与还原回收站",
    user: "否",
    uploader: "否",
    admin: "是",
    superAdmin: "是",
  },
  {
    name: "设为最新快照",
    user: "否",
    uploader: "否",
    admin: "是",
    superAdmin: "是",
  },
  {
    name: "手动最终清理",
    user: "否",
    uploader: "否",
    admin: "否",
    superAdmin: "是",
  },
  {
    name: "用户层级管理",
    user: "否",
    uploader: "否",
    admin: "低于自己层级",
    superAdmin: "低于自己层级",
  },
  {
    name: "查看审计日志",
    user: "否",
    uploader: "否",
    admin: "否",
    superAdmin: "是",
  },
];

function formatDetail(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
