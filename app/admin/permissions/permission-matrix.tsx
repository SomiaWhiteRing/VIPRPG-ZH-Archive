import { useConfirm } from "@/app/components/ui/confirm-provider";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { Checkbox } from "@/app/components/ui/checkbox";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Table } from "@/app/components/ui/table";
import { Textarea } from "@/app/components/ui/textarea";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import type { PermissionCategory } from "@/lib/authz/permissions";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_GROUPS,
  SYSTEM_ROLE_PERMISSIONS,
  permissionConfigurationWarnings,
} from "@/lib/authz/permissions";
import { ROLE_TEMPLATES, roleEditSnapshot, roleSupportsApplications } from "@/lib/authz/roles";
import type { Permission, RoleSummary } from "@/lib/dto/db/permissions";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FormEvent } from "react";
import { Fragment, useState } from "react";

const categories = Object.entries(PERMISSION_CATEGORIES).map(
  ([key, definition]) => ({
    key: key as PermissionCategory,
    ...definition,
  }),
);
const roleKindLabels = {
  built_in: "系统角色",
  bootstrap_admin: "根管理员",
  custom: "自定义角色",
};

export function PermissionMatrix({
  permissions,
  roles: initialRoles,
}: {
  permissions: readonly Permission[];
  roles: RoleSummary[];
}) {
  const [roles, setRoles] = useState(initialRoles);
  const [savedRoles, setSavedRoles] = useState(initialRoles);
  const [selectedRoleId, setSelectedRoleId] = useState(initialRoles[0]?.id);
  const [query, setQuery] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [saving, setSaving] = useState<
    "new" | "profile" | "permissions" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [conflict, setConflict] = useState<RoleSummary | null>(null);
  const [newRoleDirty, setNewRoleDirty] = useState(false);
  const role = roles.find((item) => item.id === selectedRoleId);
  const saved = savedRoles.find((item) => item.id === selectedRoleId);
  const orderedRoles = [...roles].sort((left, right) => {
    const a = savedRoles.find((item) => item.id === left.id) ?? left;
    const b = savedRoles.find((item) => item.id === right.id) ?? right;
    return Number(a.kind === "custom") - Number(b.kind === "custom") || b.priority - a.priority || a.id - b.id;
  });
  const editable = role?.kind === "custom";
  const dirtyRoleIds = roles
    .filter((item) => {
      const baseline = savedRoles.find((entry) => entry.id === item.id);
      return (
        baseline &&
        (profileChanged(item, baseline) ||
          permissionChanges(item, baseline).length > 0)
      );
    })
    .map((item) => item.id);
  const hasUnsavedChanges = dirtyRoleIds.length > 0 || newRoleDirty;
  const warnings = role
    ? permissionConfigurationWarnings([
        ...new Set([...SYSTEM_ROLE_PERMISSIONS.user, ...role.permissionKeys]),
      ])
    : [];
  const profileDirty = Boolean(role && saved && profileChanged(role, saved));
  const changedPermissions =
    role && saved ? permissionChanges(role, saved) : [];
  const search = query.trim().toLowerCase();
  const visiblePermissions = permissions.filter((permission) => {
    const category = PERMISSION_CATEGORIES[permission.category];
    return (
      !search ||
      `${permission.label} ${permission.scope} ${permission.description} ${permission.key} ${category.label} ${PERMISSION_GROUPS[category.group]}`
        .toLowerCase()
        .includes(search)
    );
  });
  const visibleGroups = Object.entries(PERMISSION_GROUPS)
    .map(([key, label]) => ({
      key,
      label,
      categories: categories
        .filter((category) => category.group === key)
        .map((category) => ({
          ...category,
          permissions: visiblePermissions.filter(
            (permission) => permission.category === category.key,
          ),
        }))
        .filter((category) => category.permissions.length > 0),
    }))
    .filter((group) => group.categories.length > 0);

  const confirm = useConfirm();
  useNavigationGuard(hasUnsavedChanges, () =>
    confirm("有未保存的角色或权限修改，确定离开并放弃这些修改吗？"),
  );

  async function request(url: string, init: RequestInit) {
    setError(null);
    const response = await fetch(url, init);
    const payload = (await response.json()) as {
      ok?: boolean;
      id?: number;
      role?: RoleSummary;
      error?: string;
      detail?: string;
      code?: string;
      currentRole?: RoleSummary;
    };
    if (payload.code === "role_conflict" && payload.currentRole) {
      setConflict(payload.currentRole);
      setError(payload.detail ?? "角色配置已被修改，当前草稿仍保留。");
    }
    if (!response.ok || !payload.ok)
      throw new Error(payload.detail ?? payload.error ?? "保存失败，请重试。");
    return payload;
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaving("new");
    try {
      const input = {
        key: String(formData.get("key"))
          .trim()
          .toLowerCase()
          .replace(/^_+|_+$/g, ""),
        name: String(formData.get("name")).trim(),
        description: String(formData.get("description")).trim(),
        priority: Number(formData.get("priority")),
      };
      const payload = await request("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const created = payload.role;
      if (!created) throw new Error("角色已创建，但未收到角色资料。请刷新页面后查看。");
      setRoles((current) => [...current, created]);
      setSavedRoles((current) => [...current, created]);
      setSelectedRoleId(created.id);
      setQuery("");
      toast.success(`已创建“${created.name}”，请选择需要授予的权限。`);
      form.reset();
      setNewRoleDirty(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "创建失败，请重试。");
    } finally {
      setSaving(null);
    }
  }

  async function createWikiRole() {
    setSaving("new");
    try {
      const payload = await request("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: "wiki_editor" }),
      });
      const created = payload.role;
      if (!created) throw new Error("角色已创建，请刷新查看。");
      setRoles((current) => [...current, created]);
      setSavedRoles((current) => [...current, created]);
      setSelectedRoleId(created.id);
      setConflict(null);
      setQuery("");
      toast.success("已创建维基人角色并保存模板权限，可在用户管理中分配。");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "创建失败，请重试。");
    } finally {
      setSaving(null);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || !saved || saving !== null) return;
    setSaving("profile");
    const patch = {
      name: role.name.trim(),
      description: role.description.trim(),
      priority: role.priority,
      status: role.status,
      applicationEnabled: role.applicationEnabled,
      availableToAll: role.availableToAll,
    };
    try {
      const payload = await request(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, expected: roleEditSnapshot(saved) }),
      });
      const persisted = payload.role;
      if (!persisted) throw new Error("角色已保存，但未收到保存后的资料。请刷新页面后查看。");
      setRoles((current) =>
        current.map((item) =>
          item.id === role.id ? { ...persisted, permissionKeys: item.permissionKeys } : item,
        ),
      );
      setSavedRoles((current) =>
        current.map((item) =>
          item.id === role.id ? persisted : item,
        ),
      );
      toast.success("角色资料已保存。");
      setConflict(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "角色资料保存失败，请重试。",
      );
    } finally {
      setSaving(null);
    }
  }

  async function savePermissions() {
    if (!role || !saved || saving !== null) return;
    setSaving("permissions");
    try {
      const payload = await request(`/api/admin/roles/${role.id}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionKeys: role.permissionKeys,
          expected: roleEditSnapshot(saved),
        }),
      });
      const persisted = payload.role;
      if (!persisted) throw new Error("权限已保存，但未收到保存后的资料。请刷新页面后查看。");
      setRoles((current) => current.map((item) => item.id === role.id
        ? { ...item, permissionKeys: persisted.permissionKeys, userCount: persisted.userCount } : item));
      setSavedRoles((current) =>
        current.map((item) =>
          item.id === role.id
            ? persisted
            : item,
        ),
      );
      toast.success("该角色的权限已保存。");
      setConflict(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "权限保存失败，请重试。",
      );
    } finally {
      setSaving(null);
    }
  }

  function updateRole(patch: Partial<RoleSummary>) {
    setRoles((current) =>
      current.map((item) =>
        item.id === selectedRoleId ? { ...item, ...patch } : item,
      ),
    );
  }

  function selectRole(id: number) {
    setSelectedRoleId(id);
    setError(null);
    setConflict(null);
  }

  return (
    <div className="grid gap-6">
      <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="grid gap-3 lg:sticky lg:top-20" aria-label="账户角色">
          <div className="lg:hidden">
            <Label className="grid gap-2">
              账户角色
              <SelectField
                aria-label="选择账户角色"
                disabled={saving !== null}
                value={String(selectedRoleId ?? "")}
                onValueChange={(value) => selectRole(Number(value))}
                options={orderedRoles.map((item) => ({
                  value: String(item.id),
                  label: `${item.name}${item.status === "disabled" ? "（已停用）" : ""}${dirtyRoleIds.includes(item.id) ? " · 未保存" : ""}`,
                }))}
              />
            </Label>
          </div>
          <nav className="hidden gap-3 lg:grid" aria-label="选择账户角色">
            {[false, true].map((custom) => (
              <div className="grid gap-1" key={String(custom)}>
                <h2 className="px-2 pb-1 text-xs font-semibold text-muted">
                  {custom ? "自定义角色" : "系统角色"}
                </h2>
                {orderedRoles
                  .filter((item) => (item.kind === "custom") === custom)
                  .map((item) => (
                    <Button
                      aria-pressed={item.id === selectedRoleId}
                      className="h-auto min-h-9 justify-between whitespace-normal px-2 py-1.5 text-left"
                      disabled={saving !== null}
                      key={item.id}
                      onClick={() => selectRole(item.id)}
                      type="button"
                      variant={
                        item.id === selectedRoleId ? "secondary" : "ghost"
                      }
                    >
                      <span className="min-w-0 break-words">
                        {item.name}
                        <span className="block text-xs font-normal text-muted">
                          {item.status === "disabled" ? "已停用 · " : ""}
                          {item.userCount} 位单独授权成员
                        </span>
                      </span>
                      {dirtyRoleIds.includes(item.id) ? (
                        <span className="shrink-0 text-xs text-primary">
                          未保存
                        </span>
                      ) : null}
                    </Button>
                  ))}
                {custom && !roles.some((item) => item.kind === "custom") ? (
                  <EmptyState
                    title="暂无自定义角色"
                    variant="plain"
                    className="px-2 text-xs"
                  />
                ) : null}
              </div>
            ))}
          </nav>
        </aside>

        {role && saved ? (
          <section
            className="grid min-w-0 gap-3"
            aria-labelledby="selected-role-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="min-w-0">
                <h2
                  className="break-words text-lg font-bold"
                  id="selected-role-heading"
                >
                  {role.name}
                </h2>
                <p className="text-xs text-muted">
                  {roleKindLabels[role.kind]} · {role.userCount} 位单独授权成员 · 已选{" "}
                  {role.permissionKeys.length} / {permissions.length} 项权限
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {role.status === "disabled" ? "停用" : "启用"}
                  {role.status !== saved.status ? "（未保存）" : ""}
                </Badge>
                {!editable ? <Badge variant="outline">系统功能固定</Badge> : null}
                {role.applicationEnabled ? <Badge variant="outline">开放申请</Badge> : null}
                {role.availableToAll ? <Badge variant="outline">全员开放</Badge> : null}
              </div>
            </div>
            {error ? <Notice>{error}</Notice> : null}
            {conflict?.id === role.id ? (
              <div className="border-y border-border py-3 text-sm">
                <p>
                  服务器上的最新配置：{conflict.name} ·{" "}
                  {conflict.permissionKeys.length} 项权限。当前草稿仍保留。
                </p>
                <p className="mt-2 whitespace-pre-wrap">{conflict.description || "暂无说明"}</p>
                <p>开放申请：{conflict.applicationEnabled ? "是" : "否"}；全员开放：{conflict.availableToAll ? "是" : "否"}。</p>
                <details className="my-2">
                  <summary className="cursor-pointer">查看最新权限</summary>
                  <ul className="mt-2 grid gap-1">
                    {permissions
                      .filter((permission) =>
                        conflict.permissionKeys.includes(permission.key),
                      )
                      .map((permission) => (
                        <li key={permission.key}>{permission.label}</li>
                      ))}
                  </ul>
                </details>
                <Button
                  onClick={() => {
                    setRoles((current) =>
                      current.map((item) =>
                        item.id === conflict.id ? conflict : item,
                      ),
                    );
                    setSavedRoles((current) =>
                      current.map((item) =>
                        item.id === conflict.id ? conflict : item,
                      ),
                    );
                    setConflict(null);
                    setError(null);
                    toast.info("已载入最新配置，可以重新编辑。");
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  放弃本角色草稿并载入最新配置
                </Button>
              </div>
            ) : null}

            <section className="border-b border-border pb-5" aria-labelledby="role-profile-heading" key={role.id}>
              <h3 id="role-profile-heading" className="text-base font-semibold">角色资料与开放设置</h3>
                <form onSubmit={saveProfile} className="mt-4">
                  <fieldset
                    className="grid gap-4 sm:grid-cols-2"
                    disabled={saving !== null}
                  >
                    <Label className="grid gap-2">
                      中文名称
                      <Input
                        maxLength={80}
                        name="name"
                        readOnly={!editable}
                        required
                        value={role.name}
                        onChange={(event) =>
                          updateRole({ name: event.target.value })
                        }
                      />
                    </Label>
                    <div className="grid content-start gap-2 text-sm">
                      <span className="font-semibold">角色标识</span>
                      <code className="break-all text-muted">{role.key}</code>
                    </div>
                    <Label className="grid gap-2">
                      管理优先级
                      <Input
                        max={editable ? 699 : undefined}
                        min={editable ? 101 : undefined}
                        name="priority"
                        readOnly={!editable}
                        required
                        type="number"
                        value={role.priority}
                        onChange={(event) =>
                          updateRole({ priority: Number(event.target.value) })
                        }
                      />
                      <span className="text-xs font-normal text-muted">
                        有角色分配权限时，只能管理优先级低于自己的用户和角色。
                      </span>
                    </Label>
                    <Label className="grid gap-2">
                      角色状态
                      <SelectField
                        aria-label="角色状态"
                        disabled={!editable || saving !== null}
                        value={role.status}
                        onValueChange={(value) =>
                          updateRole({ status: value as RoleSummary["status"] })
                        }
                        options={[
                          { value: "active", label: "启用" },
                          { value: "disabled", label: "停用" },
                        ]}
                      />
                      <span className="text-xs font-normal text-muted">
                        停用后不再授予权限；重新启用会恢复原成员的授权。
                      </span>
                    </Label>
                    <Label className="grid gap-2 sm:col-span-2">
                      权限说明
                      <Textarea
                        name="description"
                        value={role.description}
                        onChange={(event) =>
                          updateRole({ description: event.target.value })
                        }
                      />
                      <span className="text-xs font-normal text-muted">在个人中心展示的角色总说明；功能明细由下方权限配置生成。</span>
                    </Label>
                    {roleSupportsApplications(role) ? (
                      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
                        <div className="grid content-start gap-2 rounded-md border border-border p-3">
                        <Label className="flex items-center gap-2" htmlFor="role-application-enabled">
                          <Checkbox id="role-application-enabled" checked={role.applicationEnabled} disabled={saving !== null}
                            onCheckedChange={(checked) => updateRole({ applicationEnabled: checked === true })} />
                          开放申请
                        </Label>
                        <p className="text-xs text-muted">关闭后会结束尚未处理的申请，并通知申请人。</p>
                        </div>
                        <div className="grid content-start gap-2 rounded-md border border-border p-3">
                        <Label className="flex items-center gap-2" htmlFor="role-available-to-all">
                          <Checkbox id="role-available-to-all" checked={role.availableToAll} disabled={saving !== null}
                            onCheckedChange={(checked) => updateRole({ availableToAll: checked === true })} />
                          向所有用户开放
                        </Label>
                        <p className="text-xs text-muted">所有正常登录用户均可使用，包括以后注册的用户。开启时结束待审申请；收回时保留单独授权。</p>
                        </div>
                      </div>
                    ) : <p className="text-sm text-muted sm:col-span-2">此角色不开放申请，也不能向所有用户开放。</p>}
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                      <Button disabled={saving !== null || !profileDirty} type="submit">
                        {saving === "profile" ? "保存中…" : "保存角色资料"}
                      </Button>
                      <Button
                        disabled={!profileDirty}
                        onClick={() =>
                          updateRole({
                            name: saved.name,
                            description: saved.description,
                            priority: saved.priority,
                            status: saved.status,
                            applicationEnabled: saved.applicationEnabled,
                            availableToAll: saved.availableToAll,
                          })
                        }
                        type="button"
                        variant="ghost"
                      >
                        撤销资料修改
                      </Button>
                      <span className="text-sm text-muted" role="status">{profileDirty ? "角色资料有未保存修改" : "角色资料已保存"}</span>
                    </div>
                  </fieldset>
                </form>
            </section>

            <div className="pt-2">
              <h3 className="text-base font-semibold">功能权限</h3>
              <p className="mt-1 text-sm text-muted">{editable ? "功能权限单独保存；多角色权限取并集。" : "系统角色的功能固定，仅供查看。"}</p>
            </div>

            {editable && warnings.length > 0 ? (
              <details className="border-b border-border pb-3" open>
                <summary className="cursor-pointer text-sm font-semibold">
                  配置提示（{warnings.length}）
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">
                  不自动授予权限；若由其他角色提供配套能力，可保留当前配置。
                </p>
              </details>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Input
                aria-label="查找权限"
                className="h-9 flex-1 basis-64"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索业务、权限、范围或备注"
                type="search"
                value={query}
              />
              <Button
                onClick={() => setCollapsedGroups([])}
                size="sm"
                type="button"
                variant="ghost"
              >
                展开全部分组
              </Button>
              <span className="text-xs text-muted" role="status">
                {search
                  ? `找到 ${visiblePermissions.length} 项`
                  : `共 ${permissions.length} 项权限`}
              </span>
            </div>
            <nav
              aria-label="跳转到权限业务分组"
              className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-2 text-sm"
            >
              {visibleGroups.map((group) => (
                <a
                  className="rounded-sm py-1 text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  href={`#permissions-${group.key}`}
                  key={group.key}
                  onClick={() =>
                    setCollapsedGroups((current) =>
                      current.filter((key) => key !== group.key),
                    )
                  }
                >
                  {group.label}
                </a>
              ))}
            </nav>
            <p className="text-xs text-muted">
              {editable ? "勾选需要授予的功能，保存后生效。" : "下方勾选状态为系统预设。"}
            </p>

            <div className="overflow-x-auto border-y border-border">
              <Table
                aria-label={`${role.name}的业务权限`}
                className="min-w-190 table-fixed [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle"
              >
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[31%]" />
                  <col className="w-[29%]" />
                  <col className="w-[16%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead className="border-b border-border bg-card text-left text-sm">
                  <tr className="[&_th]:px-3 [&_th]:py-3 [&_th]:font-semibold">
                    <th scope="col">业务对象</th>
                    <th scope="col">权限操作</th>
                    <th scope="col">适用范围</th>
                    <th scope="col">角色授权</th>
                    <th scope="col">
                      <span className="sr-only">备注</span>
                    </th>
                  </tr>
                </thead>
                {visibleGroups.map((group) => {
                  const entries = group.categories.flatMap(
                    (category) => category.permissions,
                  );
                  const granted = entries.filter((permission) =>
                    role.permissionKeys.includes(permission.key),
                  ).length;
                  const expanded =
                    Boolean(search) || !collapsedGroups.includes(group.key);
                  const allNotesExpanded =
                    expanded &&
                    entries.every((permission) =>
                      expandedNotes.includes(permission.key),
                    );
                  return (
                    <tbody aria-label={group.label} key={group.key}>
                      <tr
                        className="scroll-mt-20 border-y border-border bg-muted/10"
                        id={`permissions-${group.key}`}
                      >
                        <th className="px-3 py-1 text-left" colSpan={5}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Button
                                aria-expanded={expanded}
                                className="-ml-2 gap-2 px-2 text-sm"
                                disabled={Boolean(search)}
                                onClick={() =>
                                  setCollapsedGroups((current) =>
                                    expanded
                                      ? [...current, group.key]
                                      : current.filter(
                                          (key) => key !== group.key,
                                        ),
                                  )
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {expanded ? (
                                  <ChevronDown aria-hidden />
                                ) : (
                                  <ChevronRight aria-hidden />
                                )}
                                {group.label}
                              </Button>
                              <span className="text-xs font-normal tabular-nums text-muted">
                                {granted} / {entries.length} 已选
                                {search ? "（匹配项）" : ""}
                              </span>
                            </div>
                            <Button
                              aria-expanded={allNotesExpanded}
                              aria-label={`${allNotesExpanded ? "收起" : "展开"}${group.label}的所有备注`}
                              onClick={() => {
                                const keys = entries.map(
                                  (permission) => permission.key,
                                );
                                setCollapsedGroups((current) =>
                                  current.filter((key) => key !== group.key),
                                );
                                setExpandedNotes((current) =>
                                  allNotesExpanded
                                    ? current.filter(
                                        (key) =>
                                          !keys.some((entry) => entry === key),
                                      )
                                    : [...new Set([...current, ...keys])],
                                );
                              }}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              {allNotesExpanded
                                ? "收起所有备注"
                                : "展开所有备注"}
                            </Button>
                          </div>
                        </th>
                      </tr>
                      {expanded
                        ? group.categories.map((category) =>
                            category.permissions.map((permission, index) => {
                              const checked = role.permissionKeys.includes(
                                permission.key,
                              );
                              const changed = changedPermissions.includes(
                                permission.key,
                              );
                              const noteExpanded = expandedNotes.includes(
                                permission.key,
                              );
                              return (
                                <Fragment key={permission.key}>
                                  <tr
                                    className={`border-b border-border hover:bg-muted/5 ${changed ? "bg-primary/5" : ""}`}
                                  >
                                    <td className="text-muted">
                                      {index === 0 ? (
                                        category.label
                                      ) : (
                                        <span className="sr-only">
                                          {category.label}
                                        </span>
                                      )}
                                    </td>
                                    <th
                                      className="px-3 py-2 text-left font-normal"
                                      scope="row"
                                    >
                                      <Label
                                        className="cursor-pointer text-sm leading-5"
                                        htmlFor={`permission-${permission.key}`}
                                      >
                                        {permission.label}
                                      </Label>
                                    </th>
                                    <td
                                      id={`scope-${permission.key}`}
                                      className="text-sm text-muted"
                                    >
                                      {permission.scope}
                                    </td>
                                    <td>
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          aria-describedby={`scope-${permission.key}${noteExpanded ? ` note-${permission.key}` : ""}`}
                                          checked={checked}
                                          disabled={
                                            !editable || saving !== null
                                          }
                                          id={`permission-${permission.key}`}
                                          onCheckedChange={(next) => {
                                            const keys = new Set(
                                              role.permissionKeys,
                                            );
                                            if (next === true)
                                              keys.add(permission.key);
                                            else keys.delete(permission.key);
                                            updateRole({
                                              permissionKeys: [...keys],
                                            });
                                          }}
                                        />
                                        <span
                                          className={`whitespace-nowrap text-xs ${changed ? "font-semibold text-primary" : "text-muted"}`}
                                        >
                                          {changed
                                            ? checked
                                              ? "待授予"
                                              : "待撤销"
                                            : checked
                                              ? "已授予"
                                              : "未授予"}
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <Button
                                        aria-controls={`note-${permission.key}`}
                                        aria-expanded={noteExpanded}
                                        aria-label={`${noteExpanded ? "收起" : "查看"}${permission.label}的备注`}
                                        className="min-h-7 px-1 text-xs"
                                        onClick={() =>
                                          setExpandedNotes((current) =>
                                            noteExpanded
                                              ? current.filter(
                                                  (key) =>
                                                    key !== permission.key,
                                                )
                                              : [...current, permission.key],
                                          )
                                        }
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                      >
                                        {noteExpanded ? "收起" : "备注"}
                                      </Button>
                                    </td>
                                  </tr>
                                  <tr
                                    className="border-b border-border bg-muted/5"
                                    hidden={!noteExpanded}
                                    id={`note-${permission.key}`}
                                  >
                                    <td colSpan={5}>
                                      <p className="text-sm leading-6">
                                        {permission.description}
                                      </p>
                                      <p className="mt-1 text-xs text-muted">
                                        权限标识：<code>{permission.key}</code>
                                      </p>
                                    </td>
                                  </tr>
                                </Fragment>
                              );
                            }),
                          )
                        : null}
                    </tbody>
                  );
                })}
              </Table>
            </div>
            {visiblePermissions.length === 0 ? (
              <EmptyState
                title="没有匹配的权限，请尝试其他关键词。"
                variant="plain"
                className="py-4"
              />
            ) : null}

            {editable ? (
              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-3">
                <span className="text-sm text-muted" role="status">
                  {changedPermissions.length
                    ? `${changedPermissions.length} 项权限修改未保存（含其他分类）`
                    : "权限无未保存修改"}
                  {profileDirty ? " · 角色资料另有未保存修改" : ""}
                </span>
                <div className="flex gap-2">
                  <Button
                    disabled={
                      saving !== null || changedPermissions.length === 0
                    }
                    onClick={() =>
                      updateRole({ permissionKeys: [...saved.permissionKeys] })
                    }
                    type="button"
                    variant="ghost"
                  >
                    撤销权限修改
                  </Button>
                  <Button
                    disabled={
                      saving !== null || changedPermissions.length === 0
                    }
                    onClick={savePermissions}
                    type="button"
                  >
                    {saving === "permissions"
                      ? "保存中…"
                      : "保存该角色全部权限"}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <EmptyState title="暂无角色，请先创建角色。" />
        )}
      </div>

      <details className="border-b border-border pb-3">
        <summary className="w-fit cursor-pointer text-sm font-semibold">
          新建自定义角色
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={
              saving !== null ||
              roles.some((item) => item.key === ROLE_TEMPLATES.wiki_editor.key)
            }
            onClick={createWikiRole}
            type="button"
            variant="outline"
          >
            按模板创建维基人
          </Button>
          <span className="text-xs text-muted">
            {ROLE_TEMPLATES.wiki_editor.description}
          </span>
        </div>
        <form
          onSubmit={createRole}
          onChange={() => setNewRoleDirty(true)}
          className="mt-4"
        >
          <fieldset
            className="grid gap-4 md:grid-cols-2"
            disabled={saving !== null}
          >
            <Label className="grid gap-2">
              中文名称
              <Input maxLength={80} name="name" required />
            </Label>
            <Label className="grid gap-2">
              角色标识
              <Input
                maxLength={64}
                name="key"
                pattern="[a-z0-9]+(_[a-z0-9]+)*"
                required
                placeholder="例如：content_editor"
              />
              <span className="text-xs font-normal text-muted">
                小写字母、数字和下划线，创建后不可修改。
              </span>
            </Label>
            <Label className="grid gap-2">
              管理优先级
              <Input
                defaultValue="200"
                max={699}
                min={101}
                name="priority"
                required
                type="number"
              />
              <span className="text-xs font-normal text-muted">
                101–699；普通用户为 100，上传者为 400，管理员为 700。
              </span>
            </Label>
            <Label className="grid gap-2">
              角色备注
              <Textarea
                name="description"
                placeholder="记录角色用途或分配对象"
              />
            </Label>
            <div className="md:col-span-2">
              <Button type="submit">
                {saving === "new" ? "创建中…" : "创建角色"}
              </Button>
            </div>
          </fieldset>
        </form>
      </details>

    </div>
  );
}

function profileChanged(role: RoleSummary, saved: RoleSummary) {
  return (
    role.name.trim() !== saved.name.trim() ||
    role.description.trim() !== saved.description.trim() ||
    role.priority !== saved.priority ||
    role.status !== saved.status ||
    role.applicationEnabled !== saved.applicationEnabled ||
    role.availableToAll !== saved.availableToAll
  );
}

function permissionChanges(role: RoleSummary, saved: RoleSummary) {
  return [...new Set([...role.permissionKeys, ...saved.permissionKeys])].filter(
    (key) =>
      role.permissionKeys.includes(key) !== saved.permissionKeys.includes(key),
  );
}
