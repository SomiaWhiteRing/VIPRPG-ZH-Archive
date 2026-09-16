import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

const tones = {
  error: "border-red-300 bg-red-50 text-red-900",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
};

export function Notice({ tone = "error", className, role, ...props }: ComponentProps<"p"> & { tone?: keyof typeof tones }) {
  return <p className={cn("rounded-md border p-3 text-sm", tones[tone], className)} role={role ?? (tone === "error" ? "alert" : "status")} {...props} />;
}
