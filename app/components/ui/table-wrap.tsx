import type { ReactNode } from "react";
import { Table } from "@/app/components/ui/table";

type TableWrapProps = {
  minWidth?: number;
  compact?: boolean;
  label?: string;
  children: ReactNode;
};

export function TableWrap({ minWidth = 820, compact = false, label, children }: TableWrapProps) {
  const minWidthClass = minWidth === 760 ? "min-w-[760px]" : minWidth === 900 ? "min-w-[900px]" : minWidth === 980 ? "min-w-[980px]" : minWidth === 1040 ? "min-w-[1040px]" : "min-w-[820px]";

  return (
    <div className={`w-full overflow-x-auto ${compact ? "mt-4" : "mt-5"}`}>
      <Table
        className={`${minWidthClass} [&_th]:h-11 [&_th]:px-4 [&_th]:text-left [&_th]:align-middle [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted [&_td]:p-4 [&_td]:align-middle [&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-0`}
        aria-label={label}
      >
        {children}
      </Table>
    </div>
  );
}
