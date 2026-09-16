"use client";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { CreatorPicker } from "@/app/components/pickers/creator-picker";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import type { StaffCredit } from "@/lib/staff-credits";
import { cn } from "@/lib/ui/cn";

type Role = StaffCredit["roleKey"];
export type EditableStaffCredit = {
  roleKey: Role | "";
  roleLabel: string | null;
  selection: CreatorSelection | null;
  notes: string | null;
};
export type StaffRowError = { field: "role" | "person" | "label"; message: string };

export function StaffCreditRow({ id, index, value, roles, suggestions, disabled = false, showNotes = false, requireRoleLabel = false, error, onChange, onRemove }: {
  id: string;
  index: number;
  value: EditableStaffCredit;
  roles: readonly { value: Role; label: string }[];
  suggestions: CreatorSuggestion[];
  disabled?: boolean;
  showNotes?: boolean;
  requireRoleLabel?: boolean;
  error?: StaffRowError | null;
  onChange: (patch: Partial<EditableStaffCredit>) => void;
  onRemove: () => void;
}) {
  const feedback = (field: StaffRowError["field"]) => ({
    "aria-invalid": error?.field === field,
    "aria-describedby": error?.field === field ? `${id}-error` : undefined,
  });
  return <div className={cn("grid min-w-0 items-start gap-2", showNotes
    ? cn("border-b border-border pb-3", value.roleKey === "other" ? "md:grid-cols-[7rem_7rem_minmax(0,1fr)_minmax(8rem,1fr)_auto]" : "md:grid-cols-[7rem_minmax(0,1fr)_minmax(8rem,1fr)_auto]")
    : value.roleKey === "other" ? "grid-cols-[6.5rem_6.5rem_minmax(0,1fr)_auto]" : "grid-cols-[6.5rem_minmax(0,1fr)_auto]")}>
    <div className="grid gap-1">
      <Label className="sr-only" htmlFor={`${id}-role`}>职务</Label>
      <SelectField id={`${id}-role`} disabled={disabled} value={value.roleKey} options={[...roles]} placeholder="选择职务" {...feedback("role")}
        onValueChange={(key) => {
          const role = roles.find((option) => option.value === key);
          if (role) onChange({ roleKey: role.value, roleLabel: "" });
        }} />
    </div>
    {value.roleKey === "other" ? <div className="grid min-w-0 gap-1">
      <Label className="sr-only" htmlFor={`${id}-label`}>职务名称</Label>
      <Input id={`${id}-label`} value={value.roleLabel ?? ""} disabled={disabled} placeholder="职务名称" required={requireRoleLabel} {...feedback("label")}
        onChange={(event) => onChange({ roleLabel: event.target.value })} />
    </div> : null}
    <div className="grid min-w-0 gap-1">
      <Label className="sr-only" htmlFor={`${id}-person`}>人物</Label>
      <CreatorPicker compact id={`${id}-person`} disabled={disabled} value={value.selection} suggestions={suggestions} placeholder="搜索或新建人物"
        invalid={error?.field === "person"} errorId={error?.field === "person" ? `${id}-error` : undefined}
        onChange={(selection) => onChange({ selection })} />
    </div>
    {showNotes ? <Input aria-label={`第 ${index + 1} 条署名的备注`} placeholder="署名备注" value={value.notes ?? ""} disabled={disabled}
      onChange={(event) => onChange({ notes: event.target.value || null })} /> : null}
    <Button className="px-1.5" type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`移除第 ${index + 1} 条制作署名`} onClick={onRemove}>移除</Button>
    {error ? <p className="col-span-full text-xs text-red-600" id={`${id}-error`} role="alert">{error.message}</p> : null}
  </div>;
}
