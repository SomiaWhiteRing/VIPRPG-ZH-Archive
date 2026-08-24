import type { ReactNode } from "react";

type StatListProps = {
  items: Array<{
    label: string;
    value: ReactNode;
  }>;
  variant?: "rows" | "tiles";
  columns?: 2 | 3;
};

export function StatList({ items, variant = "rows", columns }: StatListProps) {
  return (
    <dl className={`grid gap-3 ${variant === "tiles" ? "sm:grid-cols-2" : ""} ${columns === 3 ? "md:grid-cols-3" : columns === 2 ? "md:grid-cols-2" : ""}`}>
      {items.map((item, index) => (
        <div
          className={variant === "tiles" ? "rounded-md border border-border bg-muted/10 p-3" : "grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border pb-3 last:border-0 last:pb-0"}
          key={`${item.label}-${index}`}
        >
          <dt className="text-sm font-semibold text-muted">{item.label}</dt>
          <dd className={variant === "tiles" ? "mt-1 m-0 font-bold" : "m-0 text-right font-bold break-words"}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
