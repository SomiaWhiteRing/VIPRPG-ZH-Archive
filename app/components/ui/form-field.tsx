import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: ReactNode;
};

export function FormField({ label, hint, error, wide = false, children }: FormFieldProps) {
  return (
    <label className={`field form-field${wide ? " wide-field" : ""}`}>
      <span>{label}</span>
      {hint ? <span className="field-hint">{hint}</span> : null}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
