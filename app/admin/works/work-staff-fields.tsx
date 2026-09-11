"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { CreatorPicker } from "@/app/upload/creator-picker";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { EXTRA_STAFF_ROLES, type StaffCredit } from "@/lib/staff-credits";

const roles = [{ value: "author", label: "作者" }, { value: "translator", label: "译者" }, ...EXTRA_STAFF_ROLES];
type Row = Omit<StaffCredit, "selection"> & { id: string; selection: CreatorSelection | null };

export function WorkStaffFields({ credits, suggestions }: { credits: StaffCredit[]; suggestions: CreatorSuggestion[] }) {
  const [rows, setRows] = useState<Row[]>(() => credits.map((credit, index) => ({ ...credit, id: `credit-${index}` })));
  function update(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  return <fieldset className="grid min-w-0 gap-3">
    <legend className="mb-2 text-sm font-semibold">作者、译者与其他制作人员</legend>
    <input name="work_staff" type="hidden" value={JSON.stringify(rows.map((row) => ({ selection: row.selection, roleKey: row.roleKey, roleLabel: row.roleLabel, notes: row.notes })))} />
    {rows.map((row, index) => <div className="grid items-start gap-2 border-b border-border pb-3 md:grid-cols-[7rem_minmax(0,1fr)_minmax(8rem,1fr)_auto]" key={row.id}>
      <SelectField aria-label={`第 ${index + 1} 条署名的职务`} value={row.roleKey} options={roles}
        onValueChange={(value) => update(row.id, { roleKey: value as StaffCredit["roleKey"], roleLabel: null })} />
      <CreatorPicker compact id={`admin-${row.id}`} value={row.selection} suggestions={suggestions} placeholder="搜索或新建人物"
        onChange={(selection) => update(row.id, { selection })} />
      <Input aria-label={`第 ${index + 1} 条署名的备注`} placeholder="署名备注" value={row.notes ?? ""} onChange={(event) => update(row.id, { notes: event.target.value || null })} />
      <Button type="button" size="sm" variant="ghost" aria-label={`移除第 ${index + 1} 条署名`} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>移除</Button>
      {row.roleKey === "other" ? <Input className="md:col-span-3" aria-label={`第 ${index + 1} 条署名的职务名称`} placeholder="职务名称" required value={row.roleLabel ?? ""} onChange={(event) => update(row.id, { roleLabel: event.target.value })} /> : null}
    </div>)}
    <Button className="w-fit" type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), roleKey: "author", selection: null, roleLabel: null, notes: null }])}>添加署名</Button>
  </fieldset>;
}
