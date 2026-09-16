"use client";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { CreatorPicker } from "@/app/components/pickers/creator-picker";
import { creatorSelectionKey, type CreatorSelection, type CreatorSuggestion } from "@/lib/creator-names";
import { EXTRA_STAFF_ROLES, isExtraStaffRole, type StaffCredit } from "@/lib/staff-credits";

export type StaffRow = {
  id: string;
  roleKey: StaffCredit["roleKey"] | "";
  roleLabel: string;
  selection: CreatorSelection | null;
  notes: string | null;
};

type RowError = { field: "role" | "person" | "label"; message: string };

export function staffRows(credits: StaffCredit[]): StaffRow[] {
  return credits.map((credit, index) => ({ ...credit, id: `stored-${index}`, roleLabel: credit.roleLabel ?? "" }));
}

function isBlank(row: StaffRow) {
  return !row.roleKey && !row.selection && !row.roleLabel.trim();
}

export function staffRowErrors(rows: StaffRow[]): (RowError | null)[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (isBlank(row)) return null;
    if (!isExtraStaffRole(row.roleKey)) return { field: "role", message: "请选择职务。" };
    if (!row.selection?.displayName.trim()) return { field: "person", message: "请填写人物，或移除此行。" };
    if (row.roleKey === "other" && !row.roleLabel.trim()) return { field: "label", message: "请填写职务名称。" };
    const selection = row.selection;
    const identity = creatorSelectionKey(selection);
    const key = `${identity}:${row.roleKey}`;
    if (seen.has(key)) return { field: "person", message: "已有这条署名，请移除重复行。" };
    seen.add(key);
    return null;
  });
}

export function extraStaffCredits(rows: StaffRow[]): StaffCredit[] {
  return rows.filter((row) => !isBlank(row)).map((row) => {
    if (!isExtraStaffRole(row.roleKey) || !row.selection?.displayName.trim() ||
        (row.roleKey === "other" && !row.roleLabel.trim())) throw new Error("请补全其他制作人员资料。");
    return { selection: row.selection, roleKey: row.roleKey, roleLabel: row.roleLabel.trim() || null, notes: row.notes };
  });
}

export function StaffEditor({ rows, onChange, disabled, suggestions, showErrors }: {
  rows: StaffRow[];
  onChange: (rows: StaffRow[]) => void;
  disabled: boolean;
  suggestions: CreatorSuggestion[];
  showErrors: boolean;
}) {
  const errors = showErrors ? staffRowErrors(rows) : [];
  function update(id: string, patch: Partial<StaffRow>) {
    onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  function add() {
    const id = crypto.randomUUID();
    onChange([...rows, { id, roleKey: "", roleLabel: "", selection: null, notes: null }]);
    requestAnimationFrame(() => document.getElementById(`staff-${id}-role`)?.focus());
  }
  return (
    <fieldset className="min-w-0 grid gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-bold">其他制作人员</legend>
      {rows.map((row, index) => {
        const prefix = `staff-${row.id}`;
        const error = errors[index];
        return (
          <div className={`grid min-w-0 items-start gap-2 ${row.roleKey === "other" ? "grid-cols-[6.5rem_6.5rem_minmax(0,1fr)_auto]" : "grid-cols-[6.5rem_minmax(0,1fr)_auto]"}`} key={row.id}>
            <div className="grid gap-1">
              <Label className="sr-only" htmlFor={`${prefix}-role`}>职务</Label>
              <SelectField id={`${prefix}-role`} disabled={disabled} value={row.roleKey} options={EXTRA_STAFF_ROLES}
                placeholder="选择职务" aria-invalid={error?.field === "role"} aria-describedby={error?.field === "role" ? `${prefix}-error` : undefined}
                onValueChange={(roleKey) => {
                  if (isExtraStaffRole(roleKey)) update(row.id, { roleKey, roleLabel: "" });
                }} />
            </div>
            {row.roleKey === "other" ? (
              <div className="grid min-w-0 gap-1">
                <Label className="sr-only" htmlFor={`${prefix}-label`}>职务名称</Label>
                <Input id={`${prefix}-label`} value={row.roleLabel} disabled={disabled} placeholder="职务名称"
                  aria-invalid={error?.field === "label"} aria-describedby={error?.field === "label" ? `${prefix}-error` : undefined}
                  onChange={(event) => update(row.id, { roleLabel: event.target.value })} />
              </div>
            ) : null}
            <div className="grid min-w-0 gap-1">
              <Label className="sr-only" htmlFor={`${prefix}-person`}>人物</Label>
              <CreatorPicker compact id={`${prefix}-person`} disabled={disabled} value={row.selection} suggestions={suggestions}
                placeholder="搜索或新建人物" invalid={error?.field === "person"} errorId={error?.field === "person" ? `${prefix}-error` : undefined}
                onChange={(selection) => update(row.id, { selection })} />
            </div>
            <Button className="px-1.5" size="sm" variant="ghost" type="button" disabled={disabled}
              aria-label={`移除第 ${index + 1} 条制作署名`} onClick={() => {
                onChange(rows.filter((item) => item.id !== row.id));
                requestAnimationFrame(() => document.getElementById("add-work-staff")?.focus());
              }}>移除</Button>
            {error ? <p className="col-span-full text-xs text-red-600" id={`${prefix}-error`} role="alert">{error.message}</p> : null}
          </div>
        );
      })}
      <Button className="w-fit" id="add-work-staff" variant="ghost" size="sm" type="button" disabled={disabled} onClick={add}>＋ 添加制作人员</Button>
    </fieldset>
  );
}
