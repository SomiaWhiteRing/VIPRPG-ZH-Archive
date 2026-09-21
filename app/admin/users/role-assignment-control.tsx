import { useToast } from "@/app/components/ui/toast";
import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import type { RoleSummary } from "@/lib/dto/db/permissions";
import { useState, useTransition } from "react";
import { useRevalidator } from "react-router";

export function RoleAssignmentControl({
  userId,
  initialRoleIds,
  roles,
}: {
  userId: number;
  initialRoleIds: number[];
  roles: RoleSummary[];
}) {
  const toast = useToast();
  const roleIds = initialRoleIds;

  const revalidator = useRevalidator();
  const [refreshing, startTransition] = useTransition();
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? 0);
  const [saving, setSaving] = useState(false);
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
    try {
      const response = await fetch(url, init);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!response.ok || !payload.ok)
        throw new Error(payload.detail ?? payload.error ?? "操作失败");
      startTransition(() => revalidator.revalidate());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败");
      throw cause;
    } finally {
      setSaving(false);
    }
  }

  async function assign() {
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
    <div className="grid min-w-56 gap-2">
      {assigned.map((role) => (
        <div className="flex items-center justify-between gap-2" key={role.id}>
          <span className="text-sm">
            {role.name}
            {role.status === "disabled" ? "（已停用）" : ""}
            {role.status === "active" && role.availableToAll ? "（移除单独授权后仍全员可用）" : ""}
          </span>
          <Button
            disabled={saving || refreshing}
            onClick={() => remove(role.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            移除
          </Button>
        </div>
      ))}
      {available.length > 0 ? (
        <div className="flex items-center gap-2">
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
            disabled={saving || refreshing}
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
