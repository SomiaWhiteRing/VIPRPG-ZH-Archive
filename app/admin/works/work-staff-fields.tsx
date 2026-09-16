import { StaffCreditRow } from "@/app/components/work/staff-credit-row";

import { Button } from "@/app/components/ui/button";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import type { StaffCredit } from "@/lib/staff-credits";
import { EXTRA_STAFF_ROLES } from "@/lib/staff-credits";
import { useState } from "react";

const roles = [
  { value: "author", label: "作者" },
  { value: "translator", label: "译者" },
  ...EXTRA_STAFF_ROLES,
] satisfies { value: StaffCredit["roleKey"]; label: string }[];
type Row = Omit<StaffCredit, "selection"> & {
  id: string;
  selection: CreatorSelection | null;
};

export function WorkStaffFields({
  credits,
  suggestions,
}: {
  credits: StaffCredit[];
  suggestions: CreatorSuggestion[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    credits.map((credit, index) => ({ ...credit, id: `credit-${index}` })),
  );
  function update(id: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="mb-2 text-sm font-semibold">
        作者、译者与其他制作人员
      </legend>
      <input
        name="work_staff"
        type="hidden"
        value={JSON.stringify(
          rows.map((row) => ({
            selection: row.selection,
            roleKey: row.roleKey,
            roleLabel: row.roleLabel,
            notes: row.notes,
          })),
        )}
      />
      {rows.map((row, index) => (
        <StaffCreditRow
          key={row.id}
          id={`admin-${row.id}`}
          index={index}
          value={row}
          roles={roles}
          suggestions={suggestions}
          showNotes
          requireRoleLabel
          onChange={(patch) =>
            update(row.id, { ...patch, roleKey: patch.roleKey || row.roleKey })
          }
          onRemove={() =>
            setRows((current) => current.filter((item) => item.id !== row.id))
          }
        />
      ))}
      <Button
        className="w-fit"
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setRows((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              roleKey: "author",
              selection: null,
              roleLabel: null,
              notes: null,
            },
          ])
        }
      >
        添加署名
      </Button>
    </fieldset>
  );
}
