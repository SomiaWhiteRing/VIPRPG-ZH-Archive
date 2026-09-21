import { Input } from "@/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { useRef } from "react";

/** Keeps a custom label in the selector itself without losing its preset menu. */
export function CustomSelect({
  id, label, options, value, customValue, customOption, onChange,
  placeholder, disabled = false, required = false, maxLength,
  invalid = false, descriptionId, customInputId = id,
}: {
  id: string;
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  customValue: string;
  customOption: string;
  onChange: (value: string, customValue: string) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  invalid?: boolean;
  descriptionId?: string;
  customInputId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusCustom = useRef(false);
  const custom = value === customOption;
  return (
    <div className="relative min-w-0">
      {custom ? (
        <Input id={customInputId} ref={inputRef} aria-label={`${label}自定义名称`}
          aria-invalid={invalid} aria-describedby={descriptionId}
          className="pl-2 pr-8 text-xs sm:text-sm" placeholder="自定义" value={customValue}
          disabled={disabled} required={required} maxLength={maxLength}
          onChange={(event) => onChange(customOption, event.target.value)} />
      ) : null}
      <Select disabled={disabled} value={value} onValueChange={(next) => {
        focusCustom.current = next === customOption;
        onChange(next, next === customOption && custom ? customValue : "");
      }}>
        <SelectTrigger id={custom && customInputId === id ? `${id}-menu` : id} aria-label={label}
          aria-invalid={invalid} aria-describedby={descriptionId}
          className={custom
            ? "absolute inset-y-0 right-0 w-8 justify-center rounded-l-none border-0 bg-transparent px-1 shadow-none"
            : "min-w-0 gap-1 px-2 text-xs sm:text-sm [&>span:first-child]:truncate [&>span:last-child]:shrink-0"}>
          {custom ? <span className="sr-only">{placeholder}</span> : <SelectValue placeholder={placeholder} />}
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={(event) => {
          if (!focusCustom.current) return;
          event.preventDefault();
          focusCustom.current = false;
          inputRef.current?.focus();
        }}>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
