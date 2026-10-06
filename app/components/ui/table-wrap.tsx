import { Table } from "@/app/components/ui/table";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

type TableWrapProps = {
  minWidth?: number;
  compact?: boolean;
  label?: string;
  className?: string;
  children: ReactNode;
};

export function TableWrap({
  minWidth = 820,
  compact = false,
  label,
  className,
  children,
}: TableWrapProps) {
  return (
    <div data-slot="table-surface" className={`min-w-0 w-full max-w-full overflow-x-auto rounded-[0.875rem] border border-border bg-card shadow-surface ${compact ? "mt-4" : "mt-5"}`}>
      <Table
        style={{ minWidth }}
        className={cn("border-collapse [&_th]:bg-background/75 [&_th]:px-4 [&_th]:py-3.5 [&_th]:text-left [&_th]:align-middle [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_td]:p-4 [&_td]:align-middle [&_td]:wrap-anywhere [&_tbody>tr]:border-t [&_tbody>tr]:border-border", className)}
        aria-label={label}
      >
        {children}
      </Table>
    </div>
  );
}
