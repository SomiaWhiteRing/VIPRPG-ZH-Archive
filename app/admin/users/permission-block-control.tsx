import { requestJson } from "@/lib/ui/api-response";
import { useState } from "react";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";
import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import { type PermissionKey, PERMISSION_LIST, PERMISSIONS } from "@/lib/authz/permissions";

export function PermissionBlockControl({
  userId,
  blockedKeys,
  grantedKeys,
  onSaved,
  disabled = false,
  onBusyChange,
}: {
  userId: number;
  blockedKeys: PermissionKey[];
  grantedKeys: PermissionKey[];
  onSaved: (access: AdminUserAccessUpdate) => Promise<void>;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = saving || disabled;
  const toast = useToast();
  const available = PERMISSION_LIST.filter((permission) => !blockedKeys.includes(permission.key));
  const selectedKey = available.find((permission) => permission.key === selected)?.key
    ?? available.find((permission) => grantedKeys.includes(permission.key))?.key
    ?? available[0]?.key;

  async function update(permissionKey: PermissionKey, blocked: boolean) {
    if (busy) return;
    setSaving(true);
    onBusyChange(true);
    try {
      const payload = await requestJson("/api/admin/users/" + userId + "/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKey, blocked }),
      }) as { ok?: boolean; detail?: string; error?: string; access: AdminUserAccessUpdate };
      await onSaved(payload.access);
      toast.success(blocked ? "已为此用户禁用该权限。" : "已取消单独禁用，按角色授权生效。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "权限设置失败");
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      {blockedKeys.length ? (
        <ul className="grid gap-2">
          {blockedKeys.map((key) => (
            <li key={key} className="flex items-center justify-between gap-3 rounded-lg bg-destructive/5 px-3 py-2 text-sm">
              <span className="min-w-0 text-destructive">{PERMISSIONS[key].label}</span>
              <Button className="shrink-0" type="button" size="sm" variant="outline" disabled={busy} onClick={() => void update(key, false)}>恢复</Button>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">没有单独禁用的权限。</p>}
      {selectedKey ? (
        <div className="flex min-w-0 items-center gap-2">
          <SelectField
            aria-label="要单独禁用的权限"
            className="min-w-0 flex-1"
            value={selectedKey}
            onValueChange={setSelected}
            disabled={busy}
            options={available.map((permission) => ({ value: permission.key, label: permission.label }))}
          />
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void update(selectedKey, true)}>禁用</Button>
        </div>
      ) : null}
      <p className="text-xs text-muted">单独禁用优先于所有角色授权；取消禁用后按角色授权判断。</p>
    </div>
  );
}
