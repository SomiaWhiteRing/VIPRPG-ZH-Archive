import { Info } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";

export function InfoTooltip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openOnPointerDown = useRef(false);

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            aria-expanded={open}
            aria-label="查看说明"
            className="inline-grid cursor-help size-5 shrink-0 place-items-center rounded-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 pointer-coarse:size-8"
            onPointerDown={() => {
              // Radix closes on pointer down; retain the state before that close.
              openOnPointerDown.current = open;
            }}
            onClick={(event) => {
              // Override Radix's click-to-close so touch can open the tooltip too.
              event.preventDefault();
              setOpen(event.detail === 0 ? !open : !openOnPointerDown.current);
            }}
            type="button"
          >
            <Info aria-hidden className="size-3.5" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="z-50 max-h-[var(--radix-tooltip-content-available-height)] max-w-[min(16rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain break-words rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-normal text-foreground shadow-surface"
            collisionPadding={8}
            sideOffset={6}
          >
            {children}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
