import type { TableHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}
