import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export const badgeVariants = cva("inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      secondary: "bg-muted/15 text-foreground",
      outline: "border border-border bg-card text-foreground",
      pending: "bg-amber-100 text-amber-900",
      positive: "bg-emerald-100 text-emerald-800",
      negative: "bg-red-100 text-red-800",
      uploader: "bg-lime-100 text-lime-800",
      user: "bg-sky-100 text-sky-800",
      admin: "bg-orange-100 text-orange-800",
      "super-admin": "bg-amber-100 text-amber-900",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
