import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AdminListControls, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { searchUsersForAdmin } from "@/lib/server/db/users";
import { listAssignableRoles } from "@/lib/server/db/permissions";
import { RoleAssignmentControl } from "./role-assignment-control";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/lib/authz/permissions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const adminUser = await requirePagePermission("/admin/users", "user.read");
  const canAssignRoles = hasPermission(adminUser, "user.role.assign");
  const canUpdateStatus = hasPermission(adminUser, "user.status.update");
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(searchParam(params.status), ["all", "active", "disabled"], "all");
  const sort = allowed(searchParam(params.sort), ["default", "name"], "default");
  const page = parseAdminPage(params.page);
  const [result, roles] = await Promise.all([
    searchUsersForAdmin({ actor: adminUser, query, status, sort, page, pageSize: PAGE_SIZE }),
    canAssignRoles ? listAssignableRoles(adminUser) : Promise.resolve([]),
  ]);

  return (
    <main>
      <PageHeader
        compact
        title="用户与上传权限"
        subtitle="管理账户状态以及当前管理员有权分配的角色。"
      />
      <AdminListControls action="/admin/users" noun="用户" query={query} status={status} statusOptions={[{ value: "all", label: "全部状态" }, { value: "active", label: "正常" }, { value: "disabled", label: "已禁用" }]} sort={sort} sortOptions={[{ value: "default", label: "最近注册" }, { value: "name", label: "显示名称" }]} total={result.total} />
      {result.items.length > 0 ? <TableWrap compact label="用户列表">
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
          {result.items.map((user) => (
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
      </TableWrap> : <EmptyState title="没有找到匹配的用户。" />}
      <PaginationLinks basePath="/admin/users" page={page} pageSize={PAGE_SIZE} total={result.total} params={{ q: query || undefined, status: status === "all" ? undefined : status, sort: sort === "default" ? undefined : sort }} />
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
