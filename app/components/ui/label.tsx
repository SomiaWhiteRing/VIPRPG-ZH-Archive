import { Label as LabelPrimitive } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/ui/cn";

export const Label = forwardRef<
  ComponentRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, onClick, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm font-semibold leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      ref={ref}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.detail === 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button, input, select, textarea, a[href]")) return;
        // Preserve pointer modality for the label's native focus forwarding.
        // React Aria recognizes explicit focus() as part of this interaction;
        // leave native label activation intact so the control toggles once.
        event.currentTarget.control?.focus({ preventScroll: true });
      }}
    />
  );
});
