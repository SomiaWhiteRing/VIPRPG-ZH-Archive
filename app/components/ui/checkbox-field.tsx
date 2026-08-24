"use client";

import { useState } from "react";
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
  const [checked, setChecked] = useState(defaultChecked);
  const id = `checkbox-${name.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <div className="flex min-h-10 items-center gap-2">
      <Checkbox checked={checked} disabled={disabled} id={id} onCheckedChange={(next) => setChecked(next === true)} />
      <Label htmlFor={id}>{label}</Label>
      {checked ? <input name={name} type="hidden" value={value} /> : null}
    </div>
  );
}
