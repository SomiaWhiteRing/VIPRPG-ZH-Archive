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
    <dl
      className={`stat-list stat-list--${variant}${columns ? ` stat-list--columns-${columns}` : ""}`}
    >
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
