import { requestJson } from "@/lib/ui/api-response";

import { useToast } from "@/app/components/ui/toast";
import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import type { RoleSummary } from "@/lib/dto/db/permissions";
import { useState } from "react";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";

export function RoleAssignmentControl({
  userId,
  initialRoleIds,
  currentRoles,
  roles,
  onSaved,
  disabled = false,
  onBusyChange,
}: {
  userId: number;
  initialRoleIds: number[];
  currentRoles: RoleSummary[];
  roles: RoleSummary[];
  onSaved: (access: AdminUserAccessUpdate) => Promise<void>;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const toast = useToast();
  const roleIds = initialRoleIds;

  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? 0);
  const [saving, setSaving] = useState(false);
  const busy = saving || disabled;
  const assigned = roles.filter((role) => roleIds.includes(role.id));
  const available = roles.filter(
    (role) => role.status === "active" && !roleIds.includes(role.id),
  );
  const effectiveSelectedRoleId = available.some(
    (role) => role.id === selectedRoleId,
  )
    ? selectedRoleId
    : (available[0]?.id ?? 0);

  async function request(url: string, init: RequestInit) {
    setSaving(true);
    onBusyChange(true);
    try {

      const payload = (await requestJson(url, init)) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        access: AdminUserAccessUpdate;
      };

      await onSaved(payload.access);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败");
      throw cause;
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  async function assign() {
    if (busy) return;
    if (!effectiveSelectedRoleId) return;
    try {
      await request(`/api/admin/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: effectiveSelectedRoleId }),
      });
      setSelectedRoleId(0);
      toast.success("角色已分配。");
    } catch {
      return;
    }
  }

  async function remove(roleId: number) {
    if (busy) return;
    try {
      await request(`/api/admin/users/${userId}/roles/${roleId}`, {
        method: "DELETE",
      });
      toast.success("角色已移除。");
    } catch {
      return;
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      {currentRoles.map((role) => (
        <div className="flex items-center justify-between gap-3 border-b border-border py-1.5" key={role.id}>
          <span className="min-w-0 text-sm">
            {role.name}
            {role.status === "disabled" ? "（已停用）" : ""}
            <span className="mt-0.5 block text-xs text-muted">{roleSourceLabel(role, roleIds.includes(role.id), true)}</span>
          </span>
          {assigned.some((item) => item.id === role.id) ? <Button
            className="shrink-0"
            disabled={busy}
            onClick={() => remove(role.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            移除
          </Button> : null}
        </div>
      ))}
      {available.length > 0 ? (
        <div className="mt-1 flex items-center gap-2">
          <SelectField
            aria-label="要分配的角色"
            className="min-w-0 flex-1"
            onValueChange={(value) => setSelectedRoleId(Number(value))}
            options={available.map((role) => ({
              value: String(role.id),
              label: role.name + (role.availableToAll ? "（另行单独授权）" : ""),
            }))}
            value={String(effectiveSelectedRoleId)}
          />
          <Button
            disabled={busy}
            onClick={assign}
            size="sm"
            type="button"
          >
            分配
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function roleSourceLabel(role: RoleSummary, individuallyAssigned: boolean, accountActive: boolean): string {
  return accountActive && role.status === "active" && role.availableToAll
    ? (individuallyAssigned ? "单独授权及全员开放" : "全员开放")
    : "单独授权";
}
