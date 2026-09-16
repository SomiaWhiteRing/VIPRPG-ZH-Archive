import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

/** Column count can be derived from a measured container rather than viewport breakpoints. */
export function ColumnGrid({
  columns,
  className,
  ...props
}: Omit<ComponentProps<"div">, "style"> & { columns: number }) {
  return (
    <div
      {...props}
      className={cn("grid", className)}
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, Math.floor(columns))}, minmax(0, 1fr))`,
      }}
    />
  );
}
