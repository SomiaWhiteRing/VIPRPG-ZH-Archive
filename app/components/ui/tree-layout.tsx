import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

type TreeSpacing = { depth: number; step: string };

export function TreeIndent({ depth, step, as: Container = "div", ...props }: ComponentProps<"div"> & TreeSpacing & { as?: "div" | "header" }) {
  return <Container {...props} style={{ paddingLeft: `calc(${depth} * ${step})` }} />;
}

export function TreeGuides({ depth, step, closing = false }: TreeSpacing & { closing?: boolean }) {
  return <>{Array.from({ length: depth }, (_, index) => <span aria-hidden key={index}
    className={cn("pointer-events-none absolute top-0 border-l border-primary/35", closing && index === depth - 1 ? "h-3 rounded-bl-sm border-b" : "bottom-0")}
    style={{ left: `calc(${index} * ${step})`, width: closing && index === depth - 1 ? step : undefined }}
  />)}</>;
}
