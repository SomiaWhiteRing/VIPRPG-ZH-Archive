import { CreatorPicker } from "@/app/components/pickers/creator-picker";
import { CustomSelect } from "@/app/components/ui/custom-select";
import { InformationRow } from "@/app/components/ui/information-editor";
import { Label } from "@/app/components/ui/label";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import type { MessageKey } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { creatorRoleLabel } from "@/lib/labels";
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
  messageKey: MessageKey;
};

export function StaffCreditRow({
  id,
  index,
  value,
  roles,
  suggestions,
  disabled = false,
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
  requireRoleLabel?: boolean;
  error?: StaffRowError | null;
  onChange: (patch: Partial<EditableStaffCredit>) => void;
  onRemove: () => void;
  removeFocusId?: string;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <InformationRow
      disabled={disabled}
      removeLabel={t("upload.staff.removeRow", { index: index + 1 })}
      onRemove={onRemove}
      removeFocusId={removeFocusId}
      error={error ? { id: `${id}-error`, message: t(error.messageKey) } : undefined}
      label={
        <CustomSelect
          id={`${id}-role`}
          customInputId={`${id}-label`}
          label={t("upload.staff.role")}
          disabled={disabled}
          value={value.roleKey}
          customOption="other"
          customValue={value.roleLabel ?? ""}
          options={roles.map(({ value }) => ({ value, label: creatorRoleLabel(value, locale) }))}
          placeholder={t("upload.staff.chooseRole")}
          required={requireRoleLabel}
          invalid={error?.field === "role" || error?.field === "label"}
          descriptionId={error?.field === "role" || error?.field === "label" ? `${id}-error` : undefined}
          onChange={(key, label) => {
            const role = roles.find((option) => option.value === key);
            if (role) onChange({ roleKey: role.value, roleLabel: label });
          }}
        />
      }
    >
      <div className="grid min-w-0 gap-1">
        <Label className="sr-only" htmlFor={`${id}-person`}>{t("upload.staff.person")}</Label>
        <CreatorPicker
          compact
          id={`${id}-person`}
          disabled={disabled}
          value={value.selection}
          suggestions={suggestions}
          placeholder={t("upload.staff.findPerson")}
          invalid={error?.field === "person"}
          errorId={error?.field === "person" ? `${id}-error` : undefined}
          onChange={(selection) => onChange({ selection })}
        />
      </div>
    </InformationRow>
  );
}
