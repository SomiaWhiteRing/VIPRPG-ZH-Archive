import { CustomSelect } from "@/app/components/ui/custom-select";
import { AddInformationButton, InformationRow } from "@/app/components/ui/information-editor";
import { Input } from "@/app/components/ui/input";
import { CREATOR_LINK_LIMITS, CREATOR_LINK_PRESETS, type CreatorLink } from "@/lib/creator-links";
import { useId, useState } from "react";

type LinkRow = CreatorLink & { id: string; custom: boolean };

export function CreatorLinksEditor({
  initialLinks,
  disabled = false,
  onChange,
}: {
  initialLinks: CreatorLink[];
  disabled?: boolean;
  onChange?: (links: CreatorLink[]) => void;
}) {
  const prefix = useId();
  const [rows, setRows] = useState<LinkRow[]>(() => initialLinks.map((link, index) => ({
    ...link, id: String(index), custom: !CREATOR_LINK_PRESETS.some((label) => label === link.label),
  })));
  function change(next: LinkRow[]) {
    setRows(next);
    onChange?.(next.map(({ label, url }) => ({ label, url })));
  }
  function update(id: string, patch: Partial<LinkRow>) {
    change(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  return (
    <fieldset className="grid min-w-0 gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">网站</legend>
      <input type="hidden" name="links_json" value={JSON.stringify(rows.map(({ label, url }) => ({ label, url })))} />
      {rows.map((row, index) => (
        <InformationRow key={row.id} disabled={disabled} removeLabel={`移除网站 ${index + 1}`}
          removeFocusId={`${prefix}-add`} onRemove={() => change(rows.filter((item) => item.id !== row.id))}
          label={<CustomSelect id={`${prefix}-${row.id}-type`} label={`网站 ${index + 1} 平台`}
            value={row.custom ? "custom" : row.label} customValue={row.label} customOption="custom"
            placeholder="选择平台" disabled={disabled} required maxLength={CREATOR_LINK_LIMITS.label}
            options={[...CREATOR_LINK_PRESETS.map((label) => ({ value: label, label })), { value: "custom", label: "自定义" }]}
            onChange={(value, customValue) => update(row.id, { custom: value === "custom", label: value === "custom" ? customValue : value })} />}>
          <Input className="px-2 sm:px-3" aria-label={`网站 ${index + 1} 网址`} type="url" placeholder="https://" value={row.url} required maxLength={CREATOR_LINK_LIMITS.url}
            onChange={(event) => update(row.id, { url: event.target.value })} />
        </InformationRow>
      ))}
      <AddInformationButton id={`${prefix}-add`} disabled={disabled} onAdd={() => {
        const id = crypto.randomUUID();
        change([...rows, { id, label: "", url: "", custom: false }]);
        return `${prefix}-${id}-type`;
      }}>添加网站</AddInformationButton>
    </fieldset>
  );
}
