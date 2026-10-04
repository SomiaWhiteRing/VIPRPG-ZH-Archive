import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

const tones = {
  error: "border-red-300 bg-red-50 text-red-900 dark:border-red-400/40 dark:bg-red-950/40 dark:text-red-200",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-950/40 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200",
};

export function Notice({
  tone = "error",
  className,
  role,
  ...props
}: ComponentProps<"p"> & { tone?: keyof typeof tones }) {
  return (
    <p
      className={cn("min-w-0 wrap-anywhere rounded-md border p-3 text-sm", tones[tone], className)}
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    />
  );
}
