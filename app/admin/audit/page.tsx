import Link from "next/link";
import { requireSuperAdminPageUser } from "@/lib/server/auth/guards";
import { roleLabel } from "@/lib/server/auth/roles";
import {
  listAdminAuditLogs,
  listAdminRoleEvents,
} from "@/lib/server/db/admin-audit";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

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
      <header className="page-header">
        <div>
          <p className="eyebrow">Super Admin Audit</p>
          <h1>审计日志</h1>
          <p className="subtitle">
            仅超级管理员可访问。这里集中查看登录/验证码/归档维护/最终清理等审计日志，
            以及用户层级调整事件。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin">
            返回管理端
          </Link>
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>权限清单</h2>
        <div className="table-wrap compact-table-wrap">
          <table className="data-table admin-ops-table">
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
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>用户层级事件</h2>
        {roleEvents.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table admin-audit-table">
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
                        <span className="mono">inbox #{event.sourceInboxItemId}</span>
                      ) : (
                        "直接调整"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">还没有用户层级事件。</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>系统审计日志</h2>
        {auditLogs.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table admin-audit-table">
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
            </table>
          </div>
        ) : (
          <p className="muted-line">还没有系统审计日志。</p>
        )}
      </section>
    </main>
  );
}

const permissionRows = [
  {
    name: "上传/导入游戏",
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
    name: "查看回收站/还原",
    user: "否",
    uploader: "否",
    admin: "是",
    superAdmin: "是",
  },
  {
    name: "设为当前版本",
    user: "否",
    uploader: "否",
    admin: "是",
    superAdmin: "是",
  },
  {
    name: "最终清理/手动 GC sweep",
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

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
