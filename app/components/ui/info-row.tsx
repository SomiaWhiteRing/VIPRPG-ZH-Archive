import { cn } from "@/lib/ui/cn";
import type { ReactNode } from "react";

export function InfoRow({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-dashed border-border py-1.75 text-sm last:border-b-0">
      <dt className="w-17 shrink-0 text-xs text-muted wrap-anywhere">
        {label}
      </dt>
      <dd className={cn("m-0 min-w-0 wrap-anywhere", mono && "font-mono")}>
        {children}
      </dd>
    </div>
  );
}
