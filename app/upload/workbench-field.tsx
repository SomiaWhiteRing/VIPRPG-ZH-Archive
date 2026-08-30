import type { ReactNode } from "react";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/lib/ui/cn";

export function WorkbenchField({
  children,
  className,
  controlId,
  label,
  required = false,
}: {
  children: ReactNode;
  className?: string;
  controlId?: string;
  label: ReactNode;
  required?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-x-3",
        className,
      )}
    >
      <Label className="font-bold sm:pt-2.5" htmlFor={controlId}>
        {label}
        {required ? <span className="ml-1 text-accent">*</span> : null}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
