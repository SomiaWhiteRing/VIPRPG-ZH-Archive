import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { lowerRoles, roleLabel } from "@/lib/server/auth/roles";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listUsersForAdmin, type ArchiveUser } from "@/lib/server/db/users";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const adminUser = await requireAdminPageUser("/admin/users");
  const users = await listUsersForAdmin(adminUser);
  const assignableRoles = lowerRoles(adminUser.role);
  const unreadInboxCount = await countUnreadInboxItemsForUser(adminUser);

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Users</p>
          <h1>用户与上传权限</h1>
          <p className="subtitle">
            当前层级：{roleLabel(adminUser.role)}。这里只显示低于你层级的用户，
            可调整为低于你层级的任意角色。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/admin">
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
          <Link className="button" href="/">
            返回首页
          </Link>
        </div>
      </header>

      <section className="table-wrap" aria-label="用户列表">
        <table className="data-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
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
                  <span className={`badge ${roleBadgeClass(user.role)}`}>
                    {roleLabel(user.role)}
                  </span>
                </td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
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
                    >
                      {assignableRoles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                    <button className="button primary" type="submit">
                      保存
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function roleBadgeClass(role: ArchiveUser["role"]): string {
  if (role === "super_admin") {
    return "super-admin";
  }

  return role;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
