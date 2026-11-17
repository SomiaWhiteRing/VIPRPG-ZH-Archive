import { UiFeedbackError } from "@/lib/i18n/feedback";
import { useMessages } from "@/lib/i18n/react";
import type { StaffRowError } from "@/app/components/work/staff-credit-row";
import { StaffCreditRow } from "@/app/components/work/staff-credit-row";

import { AddInformationButton } from "@/app/components/ui/information-editor";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorSelectionKey } from "@/lib/creator-names";
import type { StaffCredit } from "@/lib/staff-credits";
import { EXTRA_STAFF_ROLES, isExtraStaffRole } from "@/lib/staff-credits";

export type StaffRow = {
  id: string;
  roleKey: StaffCredit["roleKey"] | "";
  roleLabel: string;
  selection: CreatorSelection | null;
  notes: string | null;
};

export function staffRows(credits: StaffCredit[]): StaffRow[] {
  return credits.map((credit, index) => ({
    ...credit,
    id: `stored-${index}`,
    roleLabel: credit.roleLabel ?? "",
  }));
}

function isBlank(row: StaffRow) {
  return !row.roleKey && !row.selection && !row.roleLabel.trim();
}

export function staffRowErrors(rows: StaffRow[]): (StaffRowError | null)[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (isBlank(row)) return null;
    if (!isExtraStaffRole(row.roleKey))
      return { field: "role", messageKey: "upload.staff.roleRequired" };
    if (!row.selection?.displayName.trim())
      return { field: "person", messageKey: "upload.staff.personRequired" };
    if (row.roleKey === "other" && !row.roleLabel.trim())
      return { field: "label", messageKey: "upload.staff.labelRequired" };
    const selection = row.selection;
    const identity = creatorSelectionKey(selection);
    const key = `${identity}:${row.roleKey}`;
    if (seen.has(key))
      return { field: "person", messageKey: "upload.staff.duplicateRow" };
    seen.add(key);
    return null;
  });
}

export function extraStaffCredits(rows: StaffRow[]): StaffCredit[] {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => {
      if (
        !isExtraStaffRole(row.roleKey) ||
        !row.selection?.displayName.trim() ||
        (row.roleKey === "other" && !row.roleLabel.trim())
      )
        throw new UiFeedbackError("upload.staff.incomplete");
      return {
        selection: row.selection,
        roleKey: row.roleKey,
        roleLabel: row.roleLabel.trim() || null,
        notes: row.notes,
      };
    });
}

export function StaffEditor({
  rows,
  onChange,
  disabled,
  suggestions,
  showErrors,
}: {
  rows: StaffRow[];
  onChange: (rows: StaffRow[]) => void;
  disabled: boolean;
  suggestions: CreatorSuggestion[];
  showErrors: boolean;
}) {
  const t = useMessages();
  const errors = showErrors ? staffRowErrors(rows) : [];
  function update(id: string, patch: Partial<StaffRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function add() {
    const id = crypto.randomUUID();
    onChange([
      ...rows,
      { id, roleKey: "", roleLabel: "", selection: null, notes: null },
    ]);
    return `staff-${id}-role`;
  }
  return (
    <fieldset className="min-w-0 grid gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-bold">{t("upload.staff.otherStaff")}</legend>
      {rows.map((row, index) => (
        <StaffCreditRow
          key={row.id}
          id={`staff-${row.id}`}
          index={index}
          value={row}
          roles={EXTRA_STAFF_ROLES}
          suggestions={suggestions}
          disabled={disabled}
          error={errors[index]}
          onChange={(patch) =>
            update(row.id, {
              ...patch,
              roleLabel: patch.roleLabel ?? row.roleLabel,
            })
          }
          removeFocusId="add-work-staff"
          onRemove={() => onChange(rows.filter((item) => item.id !== row.id))}
        />
      ))}
      <AddInformationButton id="add-work-staff" disabled={disabled} onAdd={add}>
        {t("upload.staff.addStaff")}
      </AddInformationButton>
    </fieldset>
  );
}
