"use client";

import { Info } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";

export function InfoTooltip({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            aria-label="查看说明"
            className="inline-grid size-5 shrink-0 place-items-center rounded-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
            type="button"
          >
            <Info aria-hidden className="size-3.5" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="z-50 max-w-64 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-normal text-foreground shadow-surface"
            sideOffset={6}
          >
            {children}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
