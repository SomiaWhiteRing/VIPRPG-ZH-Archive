import { CreatorPicker } from "@/app/components/pickers/creator-picker";
import { CustomSelect } from "@/app/components/ui/custom-select";
import { InformationRow } from "@/app/components/ui/information-editor";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import type { StaffCredit } from "@/lib/staff-credits";

type Role = StaffCredit["roleKey"];
export type EditableStaffCredit = {
  roleKey: Role | "";
  roleLabel: string | null;
  selection: CreatorSelection | null;
  notes: string | null;
};
export type StaffRowError = {
  field: "role" | "person" | "label";
  message: string;
};

export function StaffCreditRow({
  id,
  index,
  value,
  roles,
  suggestions,
  disabled = false,
  showNotes = false,
  requireRoleLabel = false,
  error,
  onChange,
  onRemove,
  removeFocusId,
}: {
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
  removeFocusId?: string;
}) {
  return (
    <InformationRow
      disabled={disabled}
      removeLabel={`移除第 ${index + 1} 条制作署名`}
      onRemove={onRemove}
      removeFocusId={removeFocusId}
      error={error ? { id: `${id}-error`, message: error.message } : undefined}
      label={
        <CustomSelect
          id={`${id}-role`}
          customInputId={`${id}-label`}
          label="职务"
          disabled={disabled}
          value={value.roleKey}
          customOption="other"
          customValue={value.roleLabel ?? ""}
          options={roles}
          placeholder="选择职务"
          required={requireRoleLabel}
          invalid={error?.field === "role" || error?.field === "label"}
          descriptionId={error?.field === "role" || error?.field === "label" ? `${id}-error` : undefined}
          onChange={(key, label) => {
            const role = roles.find((option) => option.value === key);
            if (role) onChange({ roleKey: role.value, roleLabel: label });
          }}
        />
      }
      details={showNotes ? (
        <Input
          aria-label={`第 ${index + 1} 条署名的备注`}
          placeholder="署名备注"
          value={value.notes ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ notes: event.target.value || null })}
        />
      ) : undefined}
    >
      <div className="grid min-w-0 gap-1">
        <Label className="sr-only" htmlFor={`${id}-person`}>人物</Label>
        <CreatorPicker
          compact
          id={`${id}-person`}
          disabled={disabled}
          value={value.selection}
          suggestions={suggestions}
          placeholder="搜索或新建人物"
          invalid={error?.field === "person"}
          errorId={error?.field === "person" ? `${id}-error` : undefined}
          onChange={(selection) => onChange({ selection })}
        />
      </div>
    </InformationRow>
  );
}
