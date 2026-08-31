import type { ReactNode } from "react";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/lib/ui/cn";

export function WorkbenchField({
  children,
  className,
  controlId,
  info,
  label,
  required = false,
}: {
  children: ReactNode;
  className?: string;
  controlId?: string;
  info?: ReactNode;
  label: ReactNode;
  required?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-start sm:gap-x-3",
        className,
      )}
    >
      <div className="flex items-center gap-1 sm:min-h-10">
        <Label className="font-bold" htmlFor={controlId}>
          {label}
          {required ? <span className="ml-1 text-accent">*</span> : null}
        </Label>
        {info ? <InfoTooltip>{info}</InfoTooltip> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
