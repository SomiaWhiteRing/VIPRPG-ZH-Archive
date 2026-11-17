import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { useMessages, useUiLocale } from "@/lib/i18n/react";

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
import { TableWrap } from "@/app/components/ui/table-wrap";
import { Textarea } from "@/app/components/ui/textarea";
import { SmoothAnchorLink } from "@/app/components/ui/anchor-navigation";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { type PermissionCategory, PERMISSION_CATEGORIES, PERMISSION_GROUPS, SYSTEM_ROLE_PERMISSIONS, permissionConfigurationWarnings } from "@/lib/authz/permissions";

import { ROLE_TEMPLATES, roleEditSnapshot, roleSupportsApplications, roleSupportsGlobalAccess } from "@/lib/authz/roles";
import type { Permission, RoleSummary } from "@/lib/dto/db/permissions";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type FormEvent, Fragment, useState } from "react";


const categories = Object.entries(PERMISSION_CATEGORIES).map(
  ([key, definition]) => ({
    key: key as PermissionCategory,
    ...definition,
  }),
);

export function PermissionMatrix({
  permissions,
  roles: initialRoles,
}: {
  permissions: readonly Permission[];
  roles: RoleSummary[];
}) {
  const t = useMessages();
  const locale = useUiLocale();
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
      `${t(`permission.${permission.key}`)} ${t(`permission.scope.${permission.key}`)} ${t(`permission.description.${permission.key}`)} ${permission.label} ${permission.scope} ${permission.description} ${permission.key} ${t(`admin.permissions.category.${permission.category}`)} ${t(`admin.permissions.group.${category.group}`)} ${category.label} ${PERMISSION_GROUPS[category.group]}`
        .toLowerCase()
        .includes(search)
    );
  });
  const visibleGroups = (Object.keys(PERMISSION_GROUPS) as (keyof typeof PERMISSION_GROUPS)[])
    .map((key) => ({
      key,
      label: t(`admin.permissions.group.${key}`),
      categories: categories
        .filter((category) => category.group === key)
        .map((category) => ({
          ...category,
          label: t(`admin.permissions.category.${category.key}`),
          permissions: visiblePermissions.filter(
            (permission) => permission.category === category.key,
          ),
        }))
        .filter((category) => category.permissions.length > 0),
    }))
    .filter((group) => group.categories.length > 0);

  const confirm = useConfirm();
  useNavigationGuard(hasUnsavedChanges, () =>
    confirm(t("admin.roles.leave")),
  );

  async function request(url: string, init: RequestInit) {
    setError(null);
    try {

    const payload = (await requestJson(url, init)) as {
      ok?: boolean;
      id?: number;
      role?: RoleSummary;
      error?: string;
      detail?: string;
      code?: string;
      currentRole?: RoleSummary;
    };
    return payload;
    } catch (error) {
      if (error instanceof ApiResponseError && error.code === "role_conflict") {
        const currentRole = (error.payload as { currentRole?: RoleSummary }).currentRole;
        if (currentRole) setConflict(currentRole);
        setError(error.messageFor(locale));
      }
      throw error;
    }
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
      if (!created) throw new Error(t("admin.roles.missingCreated"));
      setRoles((current) => [...current, created]);
      setSavedRoles((current) => [...current, created]);
      setSelectedRoleId(created.id);
      setQuery("");
      toast.success(t("admin.roles.created", { name: created.name }));
      form.reset();
      setNewRoleDirty(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause : t("admin.roles.createFailed"));
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
      if (!created) throw new Error(t("admin.roles.createdRefresh"));
      setRoles((current) => [...current, created]);
      setSavedRoles((current) => [...current, created]);
      setSelectedRoleId(created.id);
      setConflict(null);
      setQuery("");
      toast.success(t("admin.roles.wikiCreated"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause : t("admin.roles.createFailed"));
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
      if (!persisted) throw new Error(t("admin.roles.missingProfile"));
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
      toast.success(t("admin.roles.profileSaved"));
      setConflict(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause : t("admin.roles.profileFailed"),
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
      if (!persisted) throw new Error(t("admin.roles.missingPermissions"));
      setRoles((current) => current.map((item) => item.id === role.id
        ? { ...item, permissionKeys: persisted.permissionKeys, userCount: persisted.userCount } : item));
      setSavedRoles((current) =>
        current.map((item) =>
          item.id === role.id
            ? persisted
            : item,
        ),
      );
      toast.success(t("admin.roles.permissionsSaved"));
      setConflict(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause : t("admin.roles.permissionsFailed"),
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
      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <aside className="admin-panel grid w-full shrink-0 gap-3 lg:sticky lg:top-20 lg:w-60" aria-label={t("admin.roles.roles")}>
          <div className="lg:hidden">
            <Label className="grid gap-2">
              {t("admin.roles.roles")}
              <SelectField
                aria-label={t("admin.roles.selectRole")}
                disabled={saving !== null}
                value={String(selectedRoleId ?? "")}
                onValueChange={(value) => selectRole(Number(value))}
                options={orderedRoles.map((item) => ({
                  value: String(item.id),
                  label: `${item.name}${item.status === "disabled" ? t("admin.users.inactiveRole") : ""}${dirtyRoleIds.includes(item.id) ? t("admin.roles.unsavedSuffix") : ""}`,
                }))}
              />
            </Label>
          </div>
          <nav className="hidden gap-3 lg:grid" aria-label={t("admin.roles.selectRole")}>
            {[false, true].map((custom) => (
              <div className="grid gap-1" key={String(custom)}>
                <h2 className="px-2 pb-1 text-xs font-semibold text-muted">
                  {custom ? t("admin.roles.kind.custom") : t("admin.roles.kind.built_in")}
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
                        item.id === selectedRoleId ? "neutral" : "ghost"
                      }
                    >
                      <span className="min-w-0 wrap-anywhere">
                        {item.name}
                        <span className="block text-xs font-normal text-muted">
                          {item.status === "disabled" ? t("admin.roles.disabledPrefix") : ""}
                          {t("admin.roles.members", { count: item.userCount })}
                        </span>
                      </span>
                      {dirtyRoleIds.includes(item.id) ? (
                        <span className="shrink-0 text-xs text-primary">
                          {t("admin.roles.unsaved")}
                        </span>
                      ) : null}
                    </Button>
                  ))}
                {custom && !roles.some((item) => item.kind === "custom") ? (
                  <EmptyState
                    title={t("admin.roles.noCustom")}
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
            className="admin-panel admin-workspace-panel grid w-full min-w-0 flex-1 grid-cols-1 gap-3 wrap-anywhere"
            aria-labelledby="selected-role-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div className="min-w-0">
                <h2
                  className="wrap-anywhere text-lg font-bold"
                  id="selected-role-heading"
                >
                  {role.name}
                </h2>
                <p className="text-xs text-muted">
                  {t("admin.roles.roleSummary", { kind: t(`admin.roles.kind.${role.kind}`), members: role.userCount, selected: role.permissionKeys.length, total: permissions.length })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {role.status === "disabled" ? t("admin.roles.disabled") : t("admin.users.activeBadge")}
                  {role.status !== saved.status ? t("admin.roles.unsavedStatus") : ""}
                </Badge>
                {!editable ? <Badge variant="outline">{t("admin.roles.fixed")}</Badge> : null}
                {role.applicationEnabled ? <Badge variant="outline">{t("admin.roles.applications")}</Badge> : null}
                {role.availableToAll ? <Badge variant="outline">{t("admin.roles.global")}</Badge> : null}
              </div>
            </div>
            {error ? <Notice>{error}</Notice> : null}
            {conflict?.id === role.id ? (
              <div className="border-y border-border py-3 text-sm">
                <p>
                  {t("admin.roles.conflict", { name: conflict.name, count: conflict.permissionKeys.length })}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{conflict.description || t("admin.roles.noDescription")}</p>
                <p>{t("admin.roles.conflictFlags", { applications: t(conflict.applicationEnabled ? "admin.archiveDetail.yes" : "admin.archiveDetail.no"), global: t(conflict.availableToAll ? "admin.archiveDetail.yes" : "admin.archiveDetail.no") })}</p>
                <details className="my-2">
                  <summary className="cursor-pointer">{t("admin.roles.viewLatest")}</summary>
                  <ul className="mt-2 grid gap-1">
                    {permissions
                      .filter((permission) =>
                        conflict.permissionKeys.includes(permission.key),
                      )
                      .map((permission) => (
                        <li key={permission.key}>{t(`permission.${permission.key}`)}</li>
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
                    toast.info(t("admin.roles.latestLoaded"));
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("admin.roles.discardLoad")}
                </Button>
              </div>
            ) : null}

            <section className="border-b border-border pb-5" aria-labelledby="role-profile-heading" key={role.id}>
              <h3 id="role-profile-heading" className="text-base font-semibold">{t("admin.roles.profile")}</h3>
                <form onSubmit={saveProfile} className="mt-4">
                  <fieldset
                    className="grid gap-4 sm:grid-cols-2"
                    disabled={saving !== null}
                  >
                    <Label className="grid gap-2">
                      {t("admin.roles.chineseName")}
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
                      <span className="font-semibold">{t("admin.roles.key")}</span>
                      <code className="break-all text-muted">{role.key}</code>
                    </div>
                    <Label className="grid gap-2">
                      {t("admin.roles.priority")}
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
                        {t("admin.roles.priorityHelp")}
                      </span>
                    </Label>
                    <Label className="grid gap-2">
                      {t("admin.roles.status")}
                      <SelectField
                        aria-label={t("admin.roles.status")}
                        disabled={!editable || saving !== null}
                        value={role.status}
                        onValueChange={(value) =>
                          updateRole({ status: value as RoleSummary["status"] })
                        }
                        options={[
                          { value: "active", label: t("admin.users.activeBadge") },
                          { value: "disabled", label: t("admin.roles.disabled") },
                        ]}
                      />
                      <span className="text-xs font-normal text-muted">
                        {t("admin.roles.disableHelp")}
                      </span>
                    </Label>
                    <Label className="grid gap-2 sm:col-span-2">
                      {t("admin.roles.description")}
                      <Textarea
                        name="description"
                        value={role.description}
                        onChange={(event) =>
                          updateRole({ description: event.target.value })
                        }
                      />
                      <span className="text-xs font-normal text-muted">{t("admin.roles.descriptionHelp")}</span>
                    </Label>
                    {roleSupportsApplications(role) ? (
                      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
                        <div className="grid content-start gap-2 rounded-md border border-border p-3">
                        <Label className="flex items-center gap-2" htmlFor="role-application-enabled">
                          <Checkbox id="role-application-enabled" checked={role.applicationEnabled} disabled={saving !== null}
                            onCheckedChange={(checked) => updateRole({ applicationEnabled: checked === true })} />
                          {t("admin.roles.applications")}
                        </Label>
                        <p className="text-xs text-muted">{role.key === "admin" ? t("admin.roles.adminApplyHelp") : t("admin.roles.applyHelp")}</p>
                        </div>
                        {roleSupportsGlobalAccess(role) ? <div className="grid content-start gap-2 rounded-md border border-border p-3">
                        <Label className="flex items-center gap-2" htmlFor="role-available-to-all">
                          <Checkbox id="role-available-to-all" checked={role.availableToAll} disabled={saving !== null}
                            onCheckedChange={(checked) => updateRole({ availableToAll: checked === true })} />
                          {t("admin.roles.openToAll")}
                        </Label>
                        <p className="text-xs text-muted">{t("admin.roles.openHelp")}</p>
                        </div> : <p className="text-sm text-muted">{t("admin.roles.adminNotGlobal")}</p>}
                      </div>
                    ) : <p className="text-sm text-muted sm:col-span-2">{t("admin.roles.restricted")}</p>}
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                      <Button disabled={saving !== null || !profileDirty} type="submit">
                        {saving === "profile" ? t("admin.characterIndex.saving") : t("admin.roles.saveProfile")}
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
                        {t("admin.roles.revertProfile")}
                      </Button>
                      <span className="text-sm text-muted" role="status">{profileDirty ? t("admin.roles.profileDirty") : t("admin.roles.profileClean")}</span>
                    </div>
                  </fieldset>
                </form>
            </section>

            <div className="pt-2">
              <h3 className="text-base font-semibold">{t("admin.permissions.functional")}</h3>
              <p className="mt-1 text-sm text-muted">{editable ? t("admin.permissions.editableDescription") : t("admin.permissions.fixedDescription")}</p>
            </div>

            {editable && warnings.length > 0 ? (
              <details className="border-b border-border pb-3" open>
                <summary className="cursor-pointer text-sm font-semibold">
                  {t("admin.roles.warningCount", { count: warnings.length })}
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {warnings.map((warning) => {
                    if (warning.kind === "dependency") {
                      return <li key={warning.permission}>{t("admin.permissionWarnings.dependency", {
                        permission: t(`permission.${warning.permission}`),
                        required: t(`permission.${warning.required}`),
                      })}</li>;
                    }
                    const names = warning.missing.map((key) => t(`permission.${key}`));
                    const permissions = locale === "zh-Hans" ? names.join("、") : new Intl.ListFormat(locale).format(names);
                    return <li key={warning.kind}>{t(`admin.permissionWarnings.${warning.kind}`, { permissions })}</li>;
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted">
                  {t("admin.roles.warningHelp")}
                </p>
              </details>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Input
                aria-label={t("admin.permissions.search")}
                className="h-9 flex-1 basis-64"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("admin.permissions.searchHint")}
                type="search"
                value={query}
              />
              <Button
                onClick={() => setCollapsedGroups([])}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("admin.permissions.expandGroups")}
              </Button>
              <span className="text-xs text-muted" role="status">
                {search
                  ? t("admin.permissions.matches", { count: visiblePermissions.length })
                  : t("admin.permissions.total", { count: permissions.length })}
              </span>
            </div>
            <nav
              aria-label={t("admin.permissions.jump")}
              className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-2 text-sm"
            >
              {visibleGroups.map((group) => (
                <SmoothAnchorLink
                  className="rounded-sm py-1 text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  to={`#permissions-${group.key}`}
                  key={group.key}
                  onClick={() =>
                    setCollapsedGroups((current) =>
                      current.filter((key) => key !== group.key),
                    )
                  }
                >
                  {group.label}
                </SmoothAnchorLink>
              ))}
            </nav>
            <p className="text-xs text-muted">
              {editable ? t("admin.permissions.editableHint") : t("admin.permissions.fixedHint")}
            </p>

              <TableWrap compact minWidth={760}
                label={t("admin.permissions.roleTable", { name: role.name })}
                className="table-fixed [&_td]:px-3 [&_td]:py-2"
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
                    <th scope="col">{t("admin.permissions.object")}</th>
                    <th scope="col">{t("admin.permissions.operation")}</th>
                    <th scope="col">{t("admin.permissions.scope")}</th>
                    <th scope="col">{t("admin.permissions.grant")}</th>
                    <th scope="col">
                      <span className="sr-only">{t("admin.permissions.notes")}</span>
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
                                {t("admin.permissions.selected", { selected: granted, total: entries.length })}
                                {search ? t("admin.permissions.filtered") : ""}
                              </span>
                            </div>
                            <Button
                              aria-expanded={allNotesExpanded}
                              aria-label={t(allNotesExpanded ? "character.collapseGroup" : "character.expandGroup", { label: t("admin.permissions.groupNotes", { name: group.label }) })}
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
                                ? t("admin.permissions.collapseNotes")
                                : t("admin.permissions.expandNotes")}
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
                                        {t(`permission.${permission.key}`)}
                                      </Label>
                                    </th>
                                    <td
                                      id={`scope-${permission.key}`}
                                      className="text-sm text-muted"
                                    >
                                      {t(`permission.scope.${permission.key}`)}
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
                                              ? t("admin.permissions.grantPending")
                                              : t("admin.permissions.revokePending")
                                            : checked
                                              ? t("admin.permissions.granted")
                                              : t("admin.permissions.notGranted")}
                                        </span>
                                      </div>
                                    </td>
                                    <td>
                                      <Button
                                        aria-controls={`note-${permission.key}`}
                                        aria-expanded={noteExpanded}
                                        aria-label={t(noteExpanded ? "character.collapseGroup" : "character.expandGroup", {
                                          label: t("admin.permissions.permissionNotes", { name: t(`permission.${permission.key}`) }),
                                        })}
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
                                        {noteExpanded ? t("admin.users.collapse") : t("admin.permissions.notes")}
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
                                        {t(`permission.description.${permission.key}`)}
                                      </p>
                                      <p className="mt-1 text-xs text-muted">
                                        {t("admin.permissions.key")}: <code>{permission.key}</code>
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
              </TableWrap>
            {visiblePermissions.length === 0 ? (
              <EmptyState
                title={t("admin.permissions.empty")}
                variant="plain"
                className="py-4"
              />
            ) : null}

            {editable ? (
              <div className="admin-save-bar justify-between">
                <span className="text-sm text-muted" role="status">
                  {changedPermissions.length
                    ? t("admin.permissions.unsaved", { count: changedPermissions.length })
                    : t("admin.permissions.saved")}
                  {profileDirty ? t("admin.permissions.profileUnsaved") : ""}
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
                    {t("admin.permissions.revert")}
                  </Button>
                  <Button
                    disabled={
                      saving !== null || changedPermissions.length === 0
                    }
                    onClick={savePermissions}
                    type="button"
                  >
                    {saving === "permissions"
                      ? t("admin.characterIndex.saving")
                      : t("admin.permissions.saveAll")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <EmptyState title={t("admin.roles.empty")} />
        )}
      </div>

      <details className="admin-panel admin-details">
        <summary className="w-fit cursor-pointer text-sm font-semibold">
          {t("admin.roles.new")}
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
            {t("admin.roles.wikiTemplate")}
          </Button>
          <span className="text-xs text-muted">
            {t("admin.permissionWarnings.wiki")}
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
              {t("admin.roles.chineseName")}
              <Input maxLength={80} name="name" required />
            </Label>
            <Label className="grid gap-2">
              {t("admin.roles.key")}
              <Input
                maxLength={64}
                name="key"
                pattern="[a-z0-9]+(_[a-z0-9]+)*"
                required
                placeholder={t("admin.roles.keyExample")}
              />
              <span className="text-xs font-normal text-muted">
                {t("admin.roles.keyHelp")}
              </span>
            </Label>
            <Label className="grid gap-2">
              {t("admin.roles.priority")}
              <Input
                defaultValue="200"
                max={699}
                min={101}
                name="priority"
                required
                type="number"
              />
              <span className="text-xs font-normal text-muted">
                {t("admin.roles.priorityRange")}
              </span>
            </Label>
            <Label className="grid gap-2">
              {t("admin.roles.notes")}
              <Textarea
                name="description"
                placeholder={t("admin.roles.notesHint")}
              />
            </Label>
            <div className="md:col-span-2">
              <Button type="submit">
                {saving === "new" ? t("admin.roles.creating") : t("admin.roles.create")}
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
