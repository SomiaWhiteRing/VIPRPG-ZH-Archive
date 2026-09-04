import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";

type CheckboxFieldProps = {
  name: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  value?: string;
};

export function CheckboxField({
  name,
  label,
  defaultChecked = false,
  disabled = false,
  value = "1",
}: CheckboxFieldProps) {
  const id = `checkbox-${name.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <div className="flex min-h-10 items-center gap-2">
      <Checkbox
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={id}
        name={name}
        value={value}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
