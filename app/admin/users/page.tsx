import { requirePagePermission } from "@/app/.server/auth/authorize";
import {
  listRoles,
  listUserRoleMemberships,
} from "@/app/.server/db/permissions";
import { searchUsersForAdmin } from "@/app/.server/db/users";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission, PERMISSION_LIST } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatDate } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { RoleAssignmentControl } from "./role-assignment-control";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/users",
    "user.read",
  );
  const canAssignRoles = hasPermission(adminUser, "user.role.assign");
  const canUpdateStatus = hasPermission(adminUser, "user.status.update");
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(
    searchParam(params.status),
    ["all", "active", "disabled", "deleted"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const [result, roles] = await Promise.all([
    searchUsersForAdmin(runtime, {
      actor: adminUser,
      query,
      status,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    listRoles(runtime),
  ]);
  const memberships = await listUserRoleMemberships(
    runtime,
    result.items.map((user) => user.id),
  );
  const assignableRoles = roles.filter(
    (role) =>
      role.key !== "user" &&
      role.kind !== "bootstrap_admin" &&
      role.priority < adminUser.maxRolePriority,
  );

  return {
    canAssignRoles,
    canUpdateStatus,
    query,
    status,
    sort,
    page,
    result,
    roles,
    memberships,
    assignableRoles,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["用户与角色", "控制台"], page: loaderData?.page }, error);

export default function AdminUsersPage() {
  const {
    canAssignRoles,
    canUpdateStatus,
    query,
    status,
    sort,
    page,
    result,
    roles,
    memberships,
    assignableRoles,
  } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="用户与角色"
        subtitle="管理账户状态以及当前管理员有权分配的角色。"
      />
      <AdminListControls
        action="/admin/users"
        noun="用户"
        query={query}
        status={status}
        statusOptions={[
          { value: "all", label: "全部状态" },
          { value: "active", label: "正常" },
          { value: "disabled", label: "已禁用" },
        ]}
        sort={sort}
        sortOptions={[
          { value: "default", label: "最近注册" },
          { value: "name", label: "显示名称" },
        ]}
        total={result.total}
      />
      {result.items.length > 0 ? (
        <TableWrap compact label="用户列表">
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
                  <span className="font-mono text-sm text-muted">
                    #{user.id}
                  </span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {roles
                      .filter((role) =>
                        memberships.get(user.id)?.includes(role.id),
                      )
                      .map((role) => (
                        <span className="session-pill" key={role.id}>
                          {role.name}
                          {role.status === "disabled" ? "（已停用）" : ""}
                        </span>
                      ))}
                  </div>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-primary">
                      生效权限与来源
                    </summary>
                    {user.status !== "active" ? (
                      <p className="py-2 text-muted">
                        账户不可用，所有权限均不生效。
                      </p>
                    ) : (
                      <ul className="mt-2 grid gap-1">
                        {PERMISSION_LIST.filter((permission) =>
                          user.permissionKeys.includes(permission.key),
                        ).map((permission) => (
                          <li key={permission.key}>
                            {permission.label}
                            <span className="block text-xs text-muted">
                              {roles
                                .filter(
                                  (role) =>
                                    role.status === "active" &&
                                    memberships
                                      .get(user.id)
                                      ?.includes(role.id) &&
                                    role.permissionKeys.includes(
                                      permission.key,
                                    ),
                                )
                                .map((role) => role.name)
                                .join("、")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </td>
                <td>
                  <StatusBadge kind="account" value={user.status} />
                </td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-3">
                    {canAssignRoles && user.status === "active" ? (
                      <RoleAssignmentControl
                        initialRoleIds={memberships.get(user.id) ?? []}
                        roles={assignableRoles}
                        userId={user.id}
                      />
                    ) : null}
                    {canUpdateStatus && user.status !== "deleted" ? (
                      <form
                        action={`/api/admin/users/${user.id}/status`}
                        method="post"
                        className="inline-flex"
                      >
                        <input
                          name="status"
                          type="hidden"
                          value={
                            user.status === "active" ? "disabled" : "active"
                          }
                        />
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
      ) : (
        <EmptyState title="没有找到匹配的用户。" />
      )}
      <PaginationLinks
        basePath="/admin/users"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          status: status === "all" ? undefined : status,
          sort: sort === "default" ? undefined : sort,
        }}
      />
    </main>
  );
}

function allowed<T extends string>(
  value: string,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
