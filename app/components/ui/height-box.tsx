import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/ui/cn";

/** Measured heights stay dynamic; Tailwind owns the layout rule. */
export function HeightBox({
  height,
  className,
  ...props
}: Omit<ComponentProps<"div">, "style"> & { height?: CSSProperties["height"] }) {
  return (
    <div
      {...props}
      className={cn(height !== undefined && "h-(--box-height)", className)}
      style={
        height === undefined
          ? undefined
          : ({
              "--box-height": typeof height === "number" ? `${height}px` : height,
            } as CSSProperties)
      }
    />
  );
}
