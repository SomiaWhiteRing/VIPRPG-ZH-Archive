"use client";

import { Select as SelectPrimitive } from "radix-ui";
import {
  Fragment,
  forwardRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;
export const SelectTrigger = forwardRef<
  ComponentRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ComponentRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-50 flex max-h-[var(--radix-select-content-available-height)] min-w-32 flex-col overflow-hidden rounded-md border border-border bg-card text-foreground shadow-surface",
          className,
        )}
        position="popper"
        ref={ref}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center bg-card">
          <ChevronUp className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="min-h-0 max-h-72 p-1">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center bg-card">
          <ChevronDown className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  ComponentRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-primary/10 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export type SelectFieldOption = {
  value: string;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
};

type SelectFieldProps = Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
  "children" | "className" | "defaultValue" | "disabled" | "form" | "name" | "required" | "value"
> & {
  name?: string;
  form?: string;
  autoComplete?: string;
  value?: string;
  defaultValue?: string;
  options: SelectFieldOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  onValueChange?: (value: string) => void;
};

export function SelectField({
  name,
  form,
  autoComplete,
  value,
  defaultValue = "",
  options,
  placeholder = "请选择",
  required = false,
  disabled = false,
  className,
  triggerClassName,
  onValueChange,
  ...triggerProps
}: SelectFieldProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const selectedValue = value ?? uncontrolledValue;

  function handleValueChange(nextValue: string) {
    const next = nextValue === "__empty__" ? "" : nextValue;
    if (value === undefined) setUncontrolledValue(next);
    onValueChange?.(next);
  }

  return (
    <div className={cn("grid gap-1", className)}>
      <SelectPrimitive.Root
        autoComplete={autoComplete}
        disabled={disabled}
        form={form}
        name={name}
        onValueChange={handleValueChange}
        required={required}
        value={selectedValue}
      >
        <SelectTrigger className={triggerClassName} {...triggerProps}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <Fragment key={option.value || "__empty__"}>
              {option.separatorBefore ? (
                <SelectPrimitive.Separator className="my-1 h-px bg-border" />
              ) : null}
              <SelectItem
                disabled={option.disabled}
                value={option.value || "__empty__"}
              >
                {option.label}
              </SelectItem>
            </Fragment>
          ))}
        </SelectContent>
      </SelectPrimitive.Root>
    </div>
  );
}
