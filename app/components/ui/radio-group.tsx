import { cn } from "@/lib/ui/cn";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";
import { forwardRef } from "react";

export const RadioGroup = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      ref={ref}
      {...props}
    />
  );
});

export const RadioGroupItem = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "grid cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed size-4 place-items-center rounded-full border border-input bg-card outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      ref={ref}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  );
});
