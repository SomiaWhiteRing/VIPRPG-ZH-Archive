import { Button } from "@/app/components/ui/button";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listUsersForAdmin } from "@/lib/server/db/users";
import { listAssignableRoles } from "@/lib/server/db/permissions";
import { RoleAssignmentControl } from "./role-assignment-control";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/lib/authz/permissions";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const adminUser = await requirePagePermission("/admin/users", "user.read");
  const canAssignRoles = hasPermission(adminUser, "user.role.assign");
  const canUpdateStatus = hasPermission(adminUser, "user.status.update");
  const [users, roles, unreadInboxCount] = await Promise.all([
    listUsersForAdmin(adminUser),
    canAssignRoles ? listAssignableRoles(adminUser) : Promise.resolve([]),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        title="用户与上传权限"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <TableWrap label="用户列表">
        <thead>
          <tr>
            <th>用户</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.displayName}</strong>
                <span className="font-mono text-sm text-muted">#{user.id}</span>
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {user.roleKeys.map((role) => (
                    <span className="session-pill" key={role}>
                      {role}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <StatusBadge kind="account" value={user.status} />
              </td>
              <td>{formatDate(user.createdAt)}</td>
              <td>
                <div className="flex flex-wrap items-center gap-3">
                  {canAssignRoles ? (
                    <RoleAssignmentControl initialRoleIds={user.roleIds} roles={roles} userId={user.id} />
                  ) : null}
                  {canUpdateStatus ? (
                    <form action={`/api/admin/users/${user.id}/status`} method="post" className="inline-flex">
                      <input name="status" type="hidden" value={user.status === "active" ? "disabled" : "active"} />
                      <Button variant="outline" type="submit">
                        {user.status === "active" ? "禁用" : "启用"}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </main>
  );
}
