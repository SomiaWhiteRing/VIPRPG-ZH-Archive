import type { ReactNode } from "react";
import { Label } from "@/app/components/ui/label";

type FormFieldProps = {
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  controlId?: string;
  children: ReactNode;
};

export function FormField({ label, hint, error, wide = false, controlId, children }: FormFieldProps) {
  return (
    <div className={`grid gap-2 text-sm font-semibold ${wide ? "md:col-span-2" : ""}`}>
      <Label htmlFor={controlId}>{label}</Label>
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
      {children}
      {error ? (
        <span className="text-sm font-semibold text-red-700" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
