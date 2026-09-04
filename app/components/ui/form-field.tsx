import type { ReactNode } from "react";
import { Label } from "@/app/components/ui/label";

type FormFieldProps = {
  label: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  wide?: boolean;
  controlId?: string;
  children: ReactNode;
};

export function FormField({ label, hint, hintId, error, errorId, wide = false, controlId, children }: FormFieldProps) {
  return (
    <div className={`grid gap-2 text-sm font-semibold ${wide ? "md:col-span-2" : ""}`}>
      <Label htmlFor={controlId}>{label}</Label>
      {hint ? <span className="text-xs font-normal text-muted" id={hintId}>{hint}</span> : null}
      {children}
      {error ? (
        <span className="text-sm font-semibold text-red-700" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
