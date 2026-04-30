import Link from "next/link";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { listUsersForAdmin, type ArchiveUser } from "@/lib/server/db/users";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const adminUser = await requireAdminPageUser("/admin/users");
  const users = await listUsersForAdmin();
  const pendingCount = users.filter(
    (user) => user.role === "uploader" && user.uploadStatus === "pending",
  ).length;

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Users</p>
          <h1>用户与上传权限</h1>
          <p className="subtitle">
            当前管理员：{adminUser.displayName}。待审核上传者：
            {pendingCount.toLocaleString("zh-CN")}。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/admin">
            返回管理端
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
              <th>上传状态</th>
              <th>注册时间</th>
              <th>审批时间</th>
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
                <td>{roleLabel(user)}</td>
                <td>
                  <span className={`badge ${user.uploadStatus}`}>
                    {uploadStatusLabel(user)}
                  </span>
                </td>
                <td>{formatDate(user.createdAt)}</td>
                <td>{user.approvedAt ? formatDate(user.approvedAt) : "-"}</td>
                <td>
                  {user.role === "admin" ? (
                    <span className="muted-line">管理员无需审批</span>
                  ) : (
                    <div className="actions compact-actions">
                      {user.uploadStatus !== "approved" ? (
                        <form
                          action={`/api/admin/users/${user.id}/approve-uploader`}
                          method="post"
                        >
                          <button className="button primary" type="submit">
                            批准
                          </button>
                        </form>
                      ) : null}
                      {user.uploadStatus !== "rejected" ? (
                        <form
                          action={`/api/admin/users/${user.id}/reject-uploader`}
                          method="post"
                        >
                          <button className="button" type="submit">
                            驳回
                          </button>
                        </form>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function roleLabel(user: ArchiveUser): string {
  return user.role === "admin" ? "管理员" : "注册用户";
}

function uploadStatusLabel(user: ArchiveUser): string {
  if (user.role === "admin") {
    return "默认可上传";
  }

  if (user.uploadStatus === "approved") {
    return "已批准";
  }

  if (user.uploadStatus === "rejected") {
    return "已驳回";
  }

  return "待审核";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
