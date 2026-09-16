"use client";

import { useEffect, useRef, type ComponentProps, type KeyboardEvent } from "react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";

/** Returns true when the caller must not apply its domain-specific Enter/Backspace action. */
export function handleComboboxNavigation(event: KeyboardEvent<HTMLInputElement>, {
  count, open, activeIndex, setOpen, setActiveIndex,
}: { count: number; open: boolean; activeIndex: number; setOpen: (open: boolean) => void; setActiveIndex: (index: number) => void }) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return true;
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setActiveIndex(open ? (activeIndex + direction + count) % count : direction === 1 ? 0 : count - 1);
    setOpen(true);
    return true;
  }
  if (event.key === "Escape" && open) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    return true;
  }
  return false;
}

export function ComboboxOptions({ className, activeIndex, children, ...props }: ComponentProps<"div"> & { activeIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, children]);
  return <div ref={ref} role="listbox" className={cn("absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-64 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-surface", className)} {...props}>{children}</div>;
}

export function ComboboxOption({ selected, className, onMouseDown, ...props }: ComponentProps<typeof Button> & { selected: boolean }) {
  return <Button role="option" aria-selected={selected} size="sm" tabIndex={-1} type="button" variant="ghost"
    className={cn("flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal", selected && "bg-primary/10 text-primary", className)}
    onMouseDown={(event) => { event.preventDefault(); onMouseDown?.(event); }} {...props} />;
}
