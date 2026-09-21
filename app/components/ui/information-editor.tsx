import { Button } from "@/app/components/ui/button";
import type { ReactNode } from "react";

/** Label/selector, value and remove action stay together even on narrow screens. */
export function InformationRow({
  label, children, removeLabel, onRemove, disabled = false,
  removeFocusId, details, error,
}: {
  label: ReactNode;
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
  disabled?: boolean;
  removeFocusId?: string;
  details?: ReactNode;
  error?: { id: string; message: string };
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_auto] items-start gap-1.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:gap-2">
      <div className="min-w-0">{label}</div>
      <div className="min-w-0">{children}</div>
      <Button type="button" variant="ghost" size="sm"
        className="h-10 px-1 text-xs sm:px-1.5 sm:text-sm"
        disabled={disabled} aria-label={removeLabel} onClick={() => {
          onRemove();
          if (removeFocusId) focusField(removeFocusId);
        }}>移除</Button>
      {details ? <div className="col-span-full min-w-0">{details}</div> : null}
      {error ? <p className="col-span-full text-xs text-red-600" id={error.id} role="alert">{error.message}</p> : null}
    </div>
  );
}

/** Return the new field's ID to focus it after React renders the added row. */
export function AddInformationButton({ id, children, disabled = false, onAdd }: {
  id: string;
  children: ReactNode;
  disabled?: boolean;
  onAdd: () => string;
}) {
  return (
    <Button id={id} type="button" variant="ghost" size="sm" className="w-fit" disabled={disabled}
      onClick={() => focusField(onAdd())}>＋ {children}</Button>
  );
}

function focusField(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}
