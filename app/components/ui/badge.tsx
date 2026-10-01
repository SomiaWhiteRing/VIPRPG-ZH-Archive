import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export const badgeVariants = cva(
  "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        subtle: "bg-primary/10 text-primary",
        credit: "border border-primary/30 bg-primary/5 text-primary",
        default: "bg-primary text-primary-foreground",
        neutral: "bg-muted/15 text-foreground",
        outline: "border border-border bg-card text-foreground",
        pending: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
        positive: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
        negative: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
        uploader: "bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-200",
        user: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
        admin: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
        "super-admin": "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
