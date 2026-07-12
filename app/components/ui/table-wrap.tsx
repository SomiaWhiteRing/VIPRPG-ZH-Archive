import type { CSSProperties, ReactNode } from "react";

type TableWrapProps = {
  minWidth?: number;
  compact?: boolean;
  mobileCards?: boolean;
  label?: string;
  children: ReactNode;
};

type TableWrapStyle = CSSProperties & {
  "--table-min-width"?: string;
};

export function TableWrap({
  minWidth = 820,
  compact = false,
  mobileCards = false,
  label,
  children,
}: TableWrapProps) {
  const style: TableWrapStyle = {
    "--table-min-width": `${minWidth}px`,
  };

  return (
    <div
      className={`table-wrap table-wrap-component${compact ? " table-wrap--compact" : ""}${mobileCards ? " table-wrap--cards" : ""}`}
      style={style}
    >
      <table className="data-table" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
