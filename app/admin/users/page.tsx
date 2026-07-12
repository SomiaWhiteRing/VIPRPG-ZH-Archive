import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { lowerRoles } from "@/lib/server/auth/roles";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listUsersForAdmin } from "@/lib/server/db/users";
import { formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const adminUser = await requireAdminPageUser("/admin/users");
  const users = await listUsersForAdmin(adminUser);
  const assignableRoles = lowerRoles(adminUser.role);
  const unreadInboxCount = await countUnreadInboxItemsForUser(adminUser);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Users"
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
                  <span className="mono muted-line">#{user.id}</span>
                </td>
                <td>
                  <StatusBadge kind="role" value={user.role} />
                </td>
                <td>
                  <StatusBadge kind="account" value={user.status} />
                </td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <div className="actions compact-actions">
                    <form
                      action={`/api/admin/users/${user.id}/role`}
                      method="post"
                      className="inline-form role-form"
                    >
                      <label className="sr-only" htmlFor={`role-${user.id}`}>
                        调整 {user.displayName} 的角色
                      </label>
                      <select
                        id={`role-${user.id}`}
                        name="role"
                        defaultValue={user.role}
                        disabled={user.status !== "active"}
                      >
                        {assignableRoles.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="button primary"
                        disabled={user.status !== "active"}
                        type="submit"
                      >
                        保存
                      </button>
                    </form>
                    <form
                      action={`/api/admin/users/${user.id}/status`}
                      method="post"
                      className="inline-form"
                    >
                      <input
                        name="status"
                        type="hidden"
                        value={user.status === "active" ? "disabled" : "active"}
                      />
                      <button className="button" type="submit">
                        {user.status === "active" ? "禁用" : "启用"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
      </TableWrap>
    </main>
  );
}
