import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listRoles, listUserRoleMemberships, listUserPermissionBlocks } from "@/app/.server/db/permissions";
import { searchUsersForAdmin } from "@/app/.server/db/users";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { AdminListControls, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { useToast } from "@/app/components/ui/toast";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useRouteRefresh } from "@/app/components/use-route-refresh";
import { hasPermission, isPermissionKey, PERMISSION_LIST, PERMISSIONS } from "@/lib/authz/permissions";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";
import { formatDate } from "@/lib/format";
import { requestJson } from "@/lib/ui/api-response";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { BadgeCheck, ChevronDown, ChevronUp, ShieldCheck, ShieldMinus } from "lucide-react";
import { Fragment, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { PermissionBlockControl } from "./permission-block-control";
import { RoleAssignmentControl, roleSourceLabel } from "./role-assignment-control";
import "./users.css";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  const adminUser = await requirePagePermission(runtime, "/admin/users", "user.read");
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(searchParam(params.status), ["all", "active", "disabled", "deleted"], "all");
  const sort = allowed(searchParam(params.sort), ["default", "oldest", "name"], "default");
  const blocks = allowed(searchParam(params.blocks), ["all", "blocked", "unblocked"], "all");
  const permissionParam = searchParam(params.permission);
  const permission = isPermissionKey(permissionParam) ? permissionParam : undefined;
  const page = parseAdminPage(params.page);
  const roles = await listRoles(runtime);
  const roleId = roles.find((role) => role.kind !== "bootstrap_admin" && String(role.id) === searchParam(params.role))?.id;
  const result = await searchUsersForAdmin(runtime, {
    actor: adminUser, query, status, roleId, permission, blocks, sort, page, pageSize: PAGE_SIZE,
  });
  const memberships = await listUserRoleMemberships(runtime, result.items.map((user) => user.id));
  const permissionBlocks = await listUserPermissionBlocks(runtime, result.items.map((user) => user.id));
  const assignableRoles = roles.filter((role) =>
    role.key !== "user" && role.kind !== "bootstrap_admin" &&
    (role.key !== "admin" || adminUser.isBootstrapAdmin) && role.priority < adminUser.maxRolePriority,
  );
  return {
    canAssignRoles: hasPermission(adminUser, "user.role.assign"),
    canUpdateStatus: hasPermission(adminUser, "user.status.update"),
    canBlockPermissions: adminUser.isBootstrapAdmin,
    query, status, sort, blocks, permission, roleId, page, result, roles,
    memberships, permissionBlocks, assignableRoles,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["用户与角色", "控制台"], page: loaderData?.page }, error);

export default function AdminUsersPage() {
  const { data, refresh } = useRouteRefresh(useLoaderData<typeof loader>());
  const revalidator = useRevalidator();
  const toast = useToast();
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [pendingUsers, setPendingUsers] = useState(new Set<number>());
  const [snapshot, setSnapshot] = useState({ source: data, updates: new Map<number, AdminUserAccessUpdate>() });
  const updates = snapshot.source === data ? snapshot.updates : new Map<number, AdminUserAccessUpdate>();
  const {
    canAssignRoles, canUpdateStatus, canBlockPermissions,
    query, status, sort, blocks, permission, roleId, page,
    result: initialResult, roles, memberships: initialMemberships,
    permissionBlocks: initialPermissionBlocks, assignableRoles,
  } = data;
  const result = { ...initialResult, items: initialResult.items.map((user) => ({ ...user, ...updates.get(user.id)?.user })) };
  const memberships = new Map(initialMemberships);
  const permissionBlocks = new Map(initialPermissionBlocks);
  for (const [id, update] of updates) {
    memberships.set(id, update.roleIds);
    permissionBlocks.set(id, update.blockedKeys);
  }
  const filtered = Boolean(query || status !== "all" || sort !== "default" || roleId || permission || blocks !== "all");

  // A row shares its busy state across role, permission and account-status writes.
  function setUserSaving(id: number, saving: boolean) {
    setPendingUsers((previous) => {
      const next = new Set(previous);
      if (saving) next.add(id); else next.delete(id);
      return next;
    });
  }
  async function onAccessSaved(access: AdminUserAccessUpdate) {
    if (access.actorChanged) { await revalidator.revalidate(); return; }
    // Access changes can move a user out of the current result and change its count.
    if (!access.user || roleId || permission || blocks !== "all") { await refresh(); return; }
    setSnapshot((previous) => ({
      source: data,
      updates: new Map(previous.source === data ? previous.updates : []).set(access.userId, access),
    }));
  }
  async function updateStatus(userId: number, nextStatus: "active" | "disabled") {
    if (pendingUsers.has(userId)) return;
    setUserSaving(userId, true);
    try {
      const body = new FormData();
      body.set("status", nextStatus);
      await requestJson("/api/admin/users/" + userId + "/status", {
        method: "POST", headers: { Accept: "application/json" }, body,
      });
      await refresh();
      toast.success(nextStatus === "active" ? "账户已启用。" : "账户已禁用。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "账户状态更新失败");
    } finally {
      setUserSaving(userId, false);
    }
  }

  return (
    <main className="admin-users-page">
      <PageHeader
        compact
        eyebrow="用户权限 / 用户"
        title="用户与角色"
        subtitle="管理账户状态以及当前管理员有权分配的角色。"
        actions={<span className="inline-flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-4" aria-hidden />当前可管理范围</span>}
      />
      <AdminListControls
        key={JSON.stringify([query, status, sort, roleId, permission, blocks])}
        action="/admin/users"
        query={query}
        searchLabel="搜索用户"
        searchPlaceholder="名称、邮箱、外部认证 ID 或用户 ID"
        status={status}
        statusLabel="账户状态"
        statusOptions={[
          { value: "all", label: "全部状态" }, { value: "active", label: "正常" },
          { value: "disabled", label: "已禁用" }, { value: "deleted", label: "已注销" },
        ]}
        sort={sort}
        sortOptions={[
          { value: "default", label: "最近注册" }, { value: "oldest", label: "最早注册" },
          { value: "name", label: "显示名称" },
        ]}
        filtered={filtered}
        total={result.total}
        noun="用户"
        pageSize={PAGE_SIZE}
      >
        <div className="admin-filter-row">
          <div className="admin-field">
            <Label htmlFor="admin-users-role">角色</Label>
            <SelectField id="admin-users-role" name="role" defaultValue={String(roleId ?? "all")} options={[
              { value: "all", label: "全部角色" },
              ...roles.filter((role) => role.kind !== "bootstrap_admin").map((role) => ({
                value: String(role.id), label: role.name + (role.status === "disabled" ? "（已停用）" : ""),
              })),
            ]} />
          </div>
          <div className="admin-field">
            <Label htmlFor="admin-users-permission">生效权限</Label>
            <SelectField id="admin-users-permission" name="permission" defaultValue={permission ?? "all"} options={[
              { value: "all", label: "全部权限" },
              ...PERMISSION_LIST.map((item) => ({ value: item.key, label: item.label })),
            ]} />
          </div>
          <div className="admin-field">
            <Label htmlFor="admin-users-blocks">单独禁用权限</Label>
            <SelectField id="admin-users-blocks" name="blocks" defaultValue={blocks} options={[
              { value: "all", label: "全部用户" }, { value: "blocked", label: "有单独禁用项" },
              { value: "unblocked", label: "无单独禁用项" },
            ]} />
          </div>
        </div>
      </AdminListControls>
      {result.items.length > 0 ? (
          <TableWrap compact minWidth={760} className="admin-users-table" label="用户列表">
            <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              {result.items.map((user) => {
                const roleIds = memberships.get(user.id) ?? [];
                const blockedKeys = permissionBlocks.get(user.id) ?? [];
                const currentRoles = roles.filter((role) => roleIds.includes(role.id) ||
                  (user.status === "active" && role.status === "active" && role.availableToAll));
                const expanded = expandedUserId === user.id;
                const busy = pendingUsers.has(user.id);
                const panelId = "admin-user-" + user.id + "-management";
                return (
                  <Fragment key={user.id}>
                    <tr className={expanded ? "admin-users-selected-row" : undefined}>
                      <td>
                        <div className="flex items-center gap-3">
                          <UserAvatar avatarBlobSha256={user.avatarBlobSha256} displayName={user.displayName} size={36} className="rounded-lg" />
                          <div className="min-w-0">
                            <Link className="admin-cell-title" to={"/users/" + user.id}>{user.displayName}</Link>
                            <span className="mt-0.5 block font-mono text-xs text-muted">#{user.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {currentRoles.map((role) => (
                            <span className={"admin-users-role-pill " + (role.key !== "user" && role.status === "active" ? "admin-users-role-special" : "")} key={role.id} title={roleSourceLabel(role, roleIds.includes(role.id), user.status === "active")}>
                              {role.name}{role.status === "disabled" ? "（已停用）" : ""}
                              {user.status === "active" && role.status === "active" && role.availableToAll ? <span className="text-muted">{roleIds.includes(role.id) ? "单独＋全员" : "全员"}</span> : null}
                            </span>
                          ))}
                        </div>
                        {blockedKeys.length ? <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-destructive"><ShieldMinus className="size-3" aria-hidden />单独禁用 {blockedKeys.length} 项</span> : null}
                      </td>
                      <td><StatusBadge kind="account" value={user.status} /></td>
                      <td className="whitespace-nowrap text-xs text-muted tabular-nums">{formatDate(user.createdAt)}</td>
                      <td>
                        <Button
                          variant={expanded ? "default" : "ghost"}
                          size="sm"
                          type="button"
                          disabled={busy}
                          aria-expanded={expanded}
                          aria-controls={expanded ? panelId : undefined}
                          aria-label={(expanded ? "收起" : "查看") + user.displayName + "的管理设置"}
                          onClick={() => setExpandedUserId(expanded ? null : user.id)}
                        >
                          {expanded ? "收起" : user.status === "deleted" ? "查看" : "管理"}
                          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                        </Button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="admin-users-detail-row">
                        <td colSpan={5}>
                          <section id={panelId} aria-label={user.displayName + "的管理设置"} className="admin-users-detail">
                            {canUpdateStatus && user.status !== "deleted" ? <div className="flex justify-end">
                              <Button variant="outline" size="sm" type="button" disabled={busy} className={user.status === "active" ? "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10" : undefined}
                                onClick={() => void updateStatus(user.id, user.status === "active" ? "disabled" : "active")}>
                                {user.status === "active" ? "禁用账户" : "启用账户"}
                              </Button>
                            </div> : null}
                            <div className="admin-users-detail-columns">
                              <section aria-labelledby={panelId + "-roles"}>
                                <h2 id={panelId + "-roles"} className="admin-users-section-title"><BadgeCheck className="size-4 text-primary" aria-hidden />角色授权</h2>
                                {canAssignRoles && user.status === "active" ? (
                                  <RoleAssignmentControl disabled={busy} onBusyChange={(saving) => setUserSaving(user.id, saving)} onSaved={onAccessSaved}
                                    initialRoleIds={roleIds} currentRoles={currentRoles} roles={assignableRoles} userId={user.id} />
                                ) : (
                                  <ul className="grid gap-2 text-sm">{currentRoles.map((role) => <li key={role.id}>
                                    {role.name}{role.status === "disabled" ? "（已停用）" : ""}
                                    <span className="block text-xs text-muted">{roleSourceLabel(role, roleIds.includes(role.id), user.status === "active")}</span>
                                  </li>)}</ul>
                                )}
                                <p className="mt-3 text-xs text-muted">{user.status === "active" ? "全员开放角色移除单独授权后仍然生效。" : "账户不可用，所有权限均不生效。"}</p>
                              </section>
                              <section aria-labelledby={panelId + "-blocks"}>
                                <h2 id={panelId + "-blocks"} className="admin-users-section-title"><ShieldMinus className="size-4 text-primary" aria-hidden />单独禁用权限</h2>
                                {canBlockPermissions && user.status !== "deleted" ? (
                                  <PermissionBlockControl disabled={busy} onBusyChange={(saving) => setUserSaving(user.id, saving)} onSaved={onAccessSaved}
                                    userId={user.id} blockedKeys={blockedKeys} grantedKeys={user.permissionKeys} />
                                ) : (
                                  <div className="text-sm text-muted">{blockedKeys.length ? blockedKeys.map((key) => PERMISSIONS[key].label).join("、") : "没有单独禁用的权限。"}</div>
                                )}
                              </section>
                            </div>
                            <details className="admin-users-effective">
                              <summary className="cursor-pointer text-sm text-primary">生效权限与来源 · {user.permissionKeys.length} 项</summary>
                              {user.status !== "active" ? <p className="mt-3 text-sm text-muted">账户不可用，所有权限均不生效。</p> : (
                                <ul className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
                                  {PERMISSION_LIST.filter((item) => user.permissionKeys.includes(item.key)).map((item) => <li key={item.key} className="border-b border-border pb-2 text-sm">
                                    {item.label}
                                    <span className="mt-0.5 block text-xs text-muted">{currentRoles.filter((role) => role.status === "active" && role.permissionKeys.includes(item.key))
                                      .map((role) => role.name + "（" + roleSourceLabel(role, roleIds.includes(role.id), true) + "）").join("、")}</span>
                                  </li>)}
                                </ul>
                              )}
                            </details>
                          </section>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </TableWrap>
      ) : <EmptyState title="没有找到匹配的用户。" />}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>仅显示权限层级低于自己的账户</span>
        <PaginationLinks className="my-0" basePath="/admin/users" page={page} pageSize={PAGE_SIZE} total={result.total} params={{
          q: query || undefined, status: status === "all" ? undefined : status, sort: sort === "default" ? undefined : sort,
          role: roleId ? String(roleId) : undefined, permission, blocks: blocks === "all" ? undefined : blocks,
        }} />
      </div>
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
