import type { ComponentProps } from "react";

export function ReorderItem({
  offset,
  ...props
}: Omit<ComponentProps<"div">, "style"> & {
  offset?: { x: number; y: number };
}) {
  return (
    <div
      {...props}
      style={offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
    />
  );
}
