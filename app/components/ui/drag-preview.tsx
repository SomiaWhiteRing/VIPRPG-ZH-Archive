import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

export function DragPreview({ width, height, position, ...props }: Omit<ComponentProps<"div">, "style"> & { width?: number; height?: number; position?: { left: number; top: number } }) {
  const element = <div {...props} aria-hidden inert style={{ width, height, ...(position && { position: "fixed", left: position.left, top: position.top, zIndex: 100, pointerEvents: "none", opacity: 0.65 }) }} />;
  return position ? createPortal(element, document.body) : element;
}
