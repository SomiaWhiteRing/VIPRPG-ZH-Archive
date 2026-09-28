import type { ComponentProps } from "react";

export function DragPreview({ width, height, ...props }: Omit<ComponentProps<"div">, "style"> & { width?: number; height?: number }) {
  return <div {...props} aria-hidden style={{ width, height }} />;
}
