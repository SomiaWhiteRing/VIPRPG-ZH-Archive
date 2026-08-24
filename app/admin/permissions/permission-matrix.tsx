"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import type { Permission, RoleSummary } from "@/lib/server/db/permissions";

export function PermissionMatrix({
  permissions,
  roles: initialRoles,
}: {
  permissions: readonly Permission[];
  roles: RoleSummary[];
}) {
  const [roles, setRoles] = useState(initialRoles);
  const [saving, setSaving] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(url: string, init: RequestInit) {
    setError(null);
    const response = await fetch(url, init);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      detail?: string;
    };
    if (!response.ok || !payload.ok) throw new Error(payload.detail ?? payload.error ?? "保存失败");
  }

  async function createRole(formData: FormData) {
    setSaving("new");
    try {
      await request("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: formData.get("key"),
          name: formData.get("name"),
          description: formData.get("description"),
          priority: Number(formData.get("priority")),
        }),
      });
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
      setSaving(null);
    }
  }

  async function saveRole(role: RoleSummary) {
    setSaving(role.id);
    try {
      await request(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(role),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  async function savePermissions(role: RoleSummary) {
    setSaving(role.id);
    try {
      await request(`/api/admin/roles/${role.id}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: role.permissionKeys }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  function updateRole(roleId: number, patch: Partial<RoleSummary>) {
    setRoles((current) => current.map((role) => (role.id === roleId ? { ...role, ...patch } : role)));
  }

  return (
    <div className="grid gap-8">
      {error ? (
        <p className="text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 border-b border-border pb-8" aria-labelledby="create-role-heading">
        <h2 className="text-xl font-bold" id="create-role-heading">
          创建自定义角色
        </h2>
        <form action={createRole} className="grid gap-4 md:grid-cols-2">
          <Label className="grid gap-2">
            角色 key
            <Input name="key" pattern="[a-z0-9_]+" required />
          </Label>
          <Label className="grid gap-2">
            名称
            <Input name="name" required />
          </Label>
          <Label className="grid gap-2">
            Priority（101-699）
            <Input defaultValue="200" max="699" min="101" name="priority" required type="number" />
          </Label>
          <Label className="grid gap-2 md:col-span-2">
            描述
            <Textarea name="description" />
          </Label>
          <div>
            <Button disabled={saving === "new"} type="submit">
              {saving === "new" ? "创建中…" : "创建角色"}
            </Button>
          </div>
        </form>
      </section>

      {roles.map((role) => {
        const editable = role.kind === "custom";
        return (
          <section className="grid gap-5 border-b border-border pb-8" key={role.id} aria-labelledby={`role-${role.id}`}>
            <div>
              <h2 className="text-xl font-bold" id={`role-${role.id}`}>
                {role.name}
              </h2>
              <p className="text-sm text-muted">
                {role.key} / priority {role.priority} / {role.userCount} 个用户 / {role.kind}
              </p>
            </div>
            {editable ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Label className="grid gap-2">
                  名称
                  <Input value={role.name} onChange={(event) => updateRole(role.id, { name: event.target.value })} />
                </Label>
                <Label className="grid gap-2">
                  Priority
                  <Input
                    max="699"
                    min="101"
                    type="number"
                    value={role.priority}
                    onChange={(event) =>
                      updateRole(role.id, {
                        priority: Number(event.target.value),
                      })
                    }
                  />
                </Label>
                <Label className="grid gap-2">
                  状态
                  <SelectField
                    onValueChange={(value) =>
                      updateRole(role.id, {
                        status: value as RoleSummary["status"],
                      })
                    }
                    options={[
                      { value: "active", label: "启用" },
                      { value: "disabled", label: "停用" },
                    ]}
                    value={role.status}
                  />
                </Label>
                <Label className="grid gap-2 md:col-span-2">
                  描述
                  <Textarea
                    value={role.description}
                    onChange={(event) => updateRole(role.id, { description: event.target.value })}
                  />
                </Label>
                <div>
                  <Button disabled={saving === role.id} onClick={() => saveRole(role)} type="button">
                    保存角色资料
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">系统角色由基线和 migration 管理，网页不可修改。</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {permissions.map((permission) => {
                const checked = role.permissionKeys.includes(permission.key);
                return (
                  <Label className="flex min-h-11 items-start gap-2 border-b border-border py-2" key={permission.key}>
                    <Checkbox
                      checked={checked}
                      disabled={!editable || saving === role.id}
                      onCheckedChange={(next) => {
                        const keys = new Set(role.permissionKeys);
                        if (next === true) keys.add(permission.key);
                        else keys.delete(permission.key);
                        updateRole(role.id, { permissionKeys: [...keys] });
                      }}
                    />
                    <span>
                      <strong className="block text-sm">{permission.label}</strong>
                      <small className="font-mono text-muted">{permission.key}</small>
                    </span>
                  </Label>
                );
              })}
            </div>
            {editable ? (
              <div>
                <Button disabled={saving === role.id} onClick={() => savePermissions(role)} type="button">
                  保存权限
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
