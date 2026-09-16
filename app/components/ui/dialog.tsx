"use client";

import { Dialog as Primitive } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/ui/cn";

export const Root = Primitive.Root;
export const Trigger = Primitive.Trigger;
export const Portal = Primitive.Portal;
export const Close = Primitive.Close;
export const Description = Primitive.Description;

export const Overlay = forwardRef<ComponentRef<typeof Primitive.Overlay>, ComponentPropsWithoutRef<typeof Primitive.Overlay>>(
  function Overlay({ className, ...props }, ref) {
    return <Primitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-black/45", className)} {...props} />;
  },
);

// Geometry remains composable: centered editors, drawers and crop workbenches
// share the surface without inheriting incompatible positioning or overflow.
export const Content = forwardRef<ComponentRef<typeof Primitive.Content>, ComponentPropsWithoutRef<typeof Primitive.Content>>(
  function Content({ className, ...props }, ref) {
    return <Primitive.Content ref={ref} className={cn("fixed z-50 border border-border bg-card text-card-foreground shadow-surface", className)} {...props} />;
  },
);

export const Title = forwardRef<ComponentRef<typeof Primitive.Title>, ComponentPropsWithoutRef<typeof Primitive.Title>>(
  function Title({ className, ...props }, ref) {
    return <Primitive.Title ref={ref} className={cn("m-0 text-lg font-bold", className)} {...props} />;
  },
);
