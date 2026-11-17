import { requestJson } from "@/lib/ui/api-response";
import { useMessages } from "@/lib/i18n/react";
import { useState } from "react";
import type { AdminUserAccessUpdate } from "@/lib/dto/db/users";
import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import { type PermissionKey, PERMISSION_LIST } from "@/lib/authz/permissions";

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
  const t = useMessages();
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
      toast.success(t(blocked ? "admin.userAccess.blocked" : "admin.userAccess.unblocked"));
    } catch (error) {
      toast.error(error instanceof Error ? error : t("admin.userAccess.failed"));
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
              <span className="min-w-0 text-destructive">{t(`permission.${key}`)}</span>
              <Button className="shrink-0" type="button" size="sm" variant="outline" disabled={busy} onClick={() => void update(key, false)}>{t("admin.userAccess.restore")}</Button>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">{t("admin.users.emptyBlocks")}</p>}
      {selectedKey ? (
        <div className="flex min-w-0 items-center gap-2">
          <SelectField
            aria-label={t("admin.userAccess.select")}
            className="min-w-0 flex-1"
            value={selectedKey}
            onValueChange={setSelected}
            disabled={busy}
            options={available.map((permission) => ({ value: permission.key, label: t(`permission.${permission.key}`) }))}
          />
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void update(selectedKey, true)}>{t("admin.userAccess.block")}</Button>
        </div>
      ) : null}
      <p className="text-xs text-muted">{t("admin.userAccess.help")}</p>
    </div>
  );
}
