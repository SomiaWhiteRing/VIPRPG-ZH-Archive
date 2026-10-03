import { requestJson } from "@/lib/ui/api-response";

import { useState } from "react";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { SelectField } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import { type PermissionKey, PERMISSION_LIST, PERMISSIONS } from "@/lib/authz/permissions";


export function PermissionBlockControl({
  userId,
  displayName,
  blockedKeys,
  grantedKeys,
  onSaved,
  disabled = false,
  onBusyChange,
}: {
  userId: number;
  displayName: string;
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

      const payload = await requestJson(`/api/admin/users/${userId}/permissions`, {
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
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={busy}>单独禁用权限</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-6">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title>{displayName}的单独权限设置</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="关闭单独权限设置"><X aria-hidden="true" /></Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-muted">
            单独禁用优先于所有角色授权。取消禁用后恢复按角色授权判断。
          </Dialog.Description>
          {blockedKeys.length ? (
            <ul className="grid gap-2">
              {blockedKeys.map((key) => (
                <li key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{PERMISSIONS[key].label}</span>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => update(key, false)}>恢复</Button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">没有单独禁用的权限。</p>}
          {selectedKey ? (
            <div className="flex items-center gap-2">
              <SelectField
                aria-label="要单独禁用的权限"
                className="min-w-0 flex-1"
                value={selectedKey}
                onValueChange={setSelected}
                disabled={busy}
                options={available.map((permission) => ({ value: permission.key, label: permission.label }))}
              />
              <Button type="button" variant="destructive" disabled={busy} onClick={() => update(selectedKey, true)}>禁用</Button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
