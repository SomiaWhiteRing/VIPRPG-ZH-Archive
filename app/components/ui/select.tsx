"use client";

import { Select as SelectPrimitive } from "radix-ui";
import { Fragment, useState, type ComponentPropsWithoutRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="size-4 opacity-60" />
    </SelectPrimitive.Trigger>
  );
}
export function SelectContent({ className, ...props }: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-50 min-w-32 overflow-hidden rounded-md border border-border bg-card p-1 text-foreground shadow-surface",
          className,
        )}
        position="popper"
        {...props}
      />
    </SelectPrimitive.Portal>
  );
}
export function SelectItem({ className, children, ...props }: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-primary/10 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
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
}

export type SelectFieldOption = {
  value: string;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
};

type SelectFieldProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectFieldOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  onValueChange?: (value: string) => void;
};

export function SelectField({
  name,
  value,
  defaultValue = "",
  options,
  placeholder = "请选择",
  required = false,
  disabled = false,
  className,
  onValueChange,
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
      <SelectPrimitive.Root disabled={disabled} onValueChange={handleValueChange} value={selectedValue || undefined}>
        <SelectTrigger aria-required={required}>
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
      {name ? <input name={name} required={required} type="hidden" value={selectedValue} /> : null}
    </div>
  );
}
