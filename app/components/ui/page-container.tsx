import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

export function PageContainer({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto w-[min(1280px,calc(100%-2rem))] min-w-0 py-5 sm:py-8", className)}
      {...props}
    />
  );
}
