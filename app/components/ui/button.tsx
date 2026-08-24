import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/ui/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary: "bg-muted/15 text-foreground hover:bg-muted/25",
        outline: "border border-border bg-card text-foreground shadow-sm hover:border-primary hover:text-primary",
        ghost: "text-foreground hover:bg-muted/15",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        rm2k: "border-2 border-white bg-gradient-to-b from-rm2k-green-1 via-[#3f6c4e] to-rm2k-green-2 text-white shadow-[3px_3px_0_rgb(23_33_43_/_30%),inset_0_0_0_2px_rgb(0_0_0_/_20%)] hover:brightness-110 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_rgb(23_33_43_/_30%),inset_0_0_0_2px_rgb(0_0_0_/_20%)]",
      },
      size: {
        default: "min-h-10 px-3 py-2",
        sm: "min-h-9 rounded-md px-2.5",
        lg: "min-h-11 rounded-md px-5",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});

export type ButtonElementProps = ComponentPropsWithoutRef<typeof Button>;
export type ButtonChild = ReactNode;
