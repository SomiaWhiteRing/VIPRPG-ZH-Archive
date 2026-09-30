import { cn } from "@/lib/ui/cn";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { forwardRef } from "react";

export const Checkbox = forwardRef<
  ComponentRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed size-4 shrink-0 rounded-sm border border-input bg-card shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        className,
      )}
      ref={ref}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group/checkbox-indicator">
        <Check className="size-3.5 group-data-[state=indeterminate]/checkbox-indicator:hidden" />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]/checkbox-indicator:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
