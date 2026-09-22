import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { autoComplete, className, role, type = "text", ...props },
  ref,
) {
  return (
    <input
      autoComplete={autoComplete ?? "off"}
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type={type}
      ref={ref}
      role={role}
      {...props}
    />
  );
});
