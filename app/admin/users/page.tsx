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
import { hasPermission, isPermissionKey, PERMISSION_LIST } from "@/lib/authz/permissions";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";
import { formatDate } from "@/lib/format";
import { requestJson } from "@/lib/ui/api-response";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { BadgeCheck, ChevronDown, ChevronUp, ShieldCheck, ShieldMinus } from "lucide-react";
import { Fragment, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useLoaderData, useRevalidator } from "react-router";
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
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.users.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminUsersPage() {
  const t = useMessages();
  const locale = useUiLocale();
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
      toast.success(nextStatus === "active" ? t("admin.users.enabled") : t("admin.users.disabledDone"));
    } catch (error) {
      toast.error(error instanceof Error ? error : t("admin.users.updateFailed"));
    } finally {
      setUserSaving(userId, false);
    }
  }

  return (
    <main className="admin-users-page">
      <PageHeader
        compact
        eyebrow={`${t("admin.nav.userPermissions")} / ${t("admin.nav.users")}`}
        title={t("admin.users.title")}
        subtitle={t("admin.users.subtitle")}
        actions={<span className="inline-flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-4" aria-hidden />{t("admin.users.scope")}</span>}
      />
      <AdminListControls
        key={JSON.stringify([query, status, sort, roleId, permission, blocks])}
        action="/admin/users"
        query={query}
        searchLabel={t("admin.users.search")}
        searchPlaceholder={t("admin.users.hint")}
        status={status}
        statusLabel={t("admin.users.status")}
        statusOptions={[
          { value: "all", label: t("admin.works.all") }, { value: "active", label: t("admin.users.normal") },
          { value: "disabled", label: t("admin.users.disabled") }, { value: "deleted", label: t("admin.users.deleted") },
        ]}
        sort={sort}
        sortOptions={[
          { value: "default", label: t("admin.users.recent") }, { value: "oldest", label: t("admin.users.oldest") },
          { value: "name", label: t("admin.users.displayName") },
        ]}
        filtered={filtered}
        total={result.total}
        noun={t("admin.nav.users")}
        pageSize={PAGE_SIZE}
      >
        <div className="admin-filter-row">
          <div className="admin-field">
            <Label htmlFor="admin-users-role">{t("admin.users.role")}</Label>
            <SelectField id="admin-users-role" name="role" defaultValue={String(roleId ?? "all")} options={[
              { value: "all", label: t("admin.users.allRoles") },
              ...roles.filter((role) => role.kind !== "bootstrap_admin").map((role) => ({
                value: String(role.id), label: role.name + (role.status === "disabled" ? t("admin.users.inactiveRole") : ""),
              })),
            ]} />
          </div>
          <div className="admin-field">
            <Label htmlFor="admin-users-permission">{t("admin.users.effective")}</Label>
            <SelectField id="admin-users-permission" name="permission" defaultValue={permission ?? "all"} options={[
              { value: "all", label: t("admin.users.allPermissions") },
              ...PERMISSION_LIST.map((item) => ({ value: item.key, label: t(`permission.${item.key}`) })),
            ]} />
          </div>
          <div className="admin-field">
            <Label htmlFor="admin-users-blocks">{t("admin.users.blocks")}</Label>
            <SelectField id="admin-users-blocks" name="blocks" defaultValue={blocks} options={[
              { value: "all", label: t("admin.users.allUsers") }, { value: "blocked", label: t("admin.users.blocked") },
              { value: "unblocked", label: t("admin.users.unblocked") },
            ]} />
          </div>
        </div>
      </AdminListControls>
      {result.items.length > 0 ? (
          <TableWrap compact minWidth={760} className="admin-users-table" label={t("admin.users.table")}>
            <thead><tr><th>{t("admin.nav.users")}</th><th>{t("admin.users.role")}</th><th>{t("admin.list.status")}</th><th>{t("admin.users.registered")}</th><th>{t("admin.characterList.actions")}</th></tr></thead>
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
                            <span className={"admin-users-role-pill " + (role.key !== "user" && role.status === "active" ? "admin-users-role-special" : "")} key={role.id} title={roleSourceLabel(role, roleIds.includes(role.id), user.status === "active", locale)}>
                              {role.name}{role.status === "disabled" ? t("admin.users.inactiveRole") : ""}
                              {user.status === "active" && role.status === "active" && role.availableToAll ? <span className="text-muted">{roleIds.includes(role.id) ? t("admin.users.individualAndGlobal") : t("admin.users.global")}</span> : null}
                            </span>
                          ))}
                        </div>
                        {blockedKeys.length ? <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-destructive"><ShieldMinus className="size-3" aria-hidden />{t("admin.users.blockedCount", { count: blockedKeys.length })}</span> : null}
                      </td>
                      <td><StatusBadge kind="account" value={user.status} /></td>
                      <td className="whitespace-nowrap text-xs text-muted tabular-nums">{formatDate(user.createdAt, { locale })}</td>
                      <td>
                        <Button
                          variant={expanded ? "default" : "ghost"}
                          size="sm"
                          type="button"
                          disabled={busy}
                          aria-expanded={expanded}
                          aria-controls={expanded ? panelId : undefined}
                          aria-label={t("admin.users.toggleSettings", { name: user.displayName, expanded: expanded ? "yes" : "no" })}
                          onClick={() => setExpandedUserId(expanded ? null : user.id)}
                        >
                          {expanded ? t("admin.users.collapse") : user.status === "deleted" ? t("admin.users.view") : t("admin.users.manage")}
                          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                        </Button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="admin-users-detail-row">
                        <td colSpan={5}>
                          <section id={panelId} aria-label={t("admin.users.settings", { name: user.displayName })} className="admin-users-detail">
                            {canUpdateStatus && user.status !== "deleted" ? <div className="flex justify-end">
                              <Button variant="outline" size="sm" type="button" disabled={busy} className={user.status === "active" ? "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10" : undefined}
                                onClick={() => void updateStatus(user.id, user.status === "active" ? "disabled" : "active")}>
                                {user.status === "active" ? t("admin.users.disable") : t("admin.users.enable")}
                              </Button>
                            </div> : null}
                            <div className="admin-users-detail-columns">
                              <section aria-labelledby={panelId + "-roles"}>
                                <h2 id={panelId + "-roles"} className="admin-users-section-title"><BadgeCheck className="size-4 text-primary" aria-hidden />{t("admin.users.grants")}</h2>
                                {canAssignRoles && user.status === "active" ? (
                                  <RoleAssignmentControl disabled={busy} onBusyChange={(saving) => setUserSaving(user.id, saving)} onSaved={onAccessSaved}
                                    initialRoleIds={roleIds} currentRoles={currentRoles} roles={assignableRoles} userId={user.id} />
                                ) : (
                                  <ul className="grid gap-2 text-sm">{currentRoles.map((role) => <li key={role.id}>
                                    {role.name}{role.status === "disabled" ? t("admin.users.inactiveRole") : ""}
                                    <span className="block text-xs text-muted">{roleSourceLabel(role, roleIds.includes(role.id), user.status === "active", locale)}</span>
                                  </li>)}</ul>
                                )}
                                <p className="mt-3 text-xs text-muted">{user.status === "active" ? t("admin.users.globalRemains") : t("admin.users.accountUnavailable")}</p>
                              </section>
                              <section aria-labelledby={panelId + "-blocks"}>
                                <h2 id={panelId + "-blocks"} className="admin-users-section-title"><ShieldMinus className="size-4 text-primary" aria-hidden />{t("admin.users.blocks")}</h2>
                                {canBlockPermissions && user.status !== "deleted" ? (
                                  <PermissionBlockControl disabled={busy} onBusyChange={(saving) => setUserSaving(user.id, saving)} onSaved={onAccessSaved}
                                    userId={user.id} blockedKeys={blockedKeys} grantedKeys={user.permissionKeys} />
                                ) : (
                                  <div className="text-sm text-muted">{blockedKeys.length ? new Intl.ListFormat(locale).format(blockedKeys.map((key) => t(`permission.${key}`))) : t("admin.users.emptyBlocks")}</div>
                                )}
                              </section>
                            </div>
                            <details className="admin-users-effective">
                              <summary className="cursor-pointer text-sm text-primary">{t("admin.users.effectiveCount", { count: user.permissionKeys.length })}</summary>
                              {user.status !== "active" ? <p className="mt-3 text-sm text-muted">{t("admin.users.accountUnavailable")}</p> : (
                                <ul className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2">
                                  {PERMISSION_LIST.filter((item) => user.permissionKeys.includes(item.key)).map((item) => <li key={item.key} className="border-b border-border pb-2 text-sm">
                                    {t(`permission.${item.key}`)}
                                    <span className="mt-0.5 block text-xs text-muted">{currentRoles.filter((role) => role.status === "active" && role.permissionKeys.includes(item.key))
                                      .map((role) => role.name + "（" + roleSourceLabel(role, roleIds.includes(role.id), true, locale) + "）").join("、")}</span>
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
      ) : <EmptyState title={t("admin.users.empty")} />}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{t("admin.users.lowerPriority")}</span>
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
