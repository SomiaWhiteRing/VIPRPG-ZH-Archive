"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/ui/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ComponentRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return <TabsPrimitive.List className={cn("flex gap-0.5 border-b border-border", className)} ref={ref} {...props} />;
});

export const TabsTrigger = forwardRef<
  ComponentRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      className={cn("inline-flex min-h-10.5 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3.25 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-primary", className)}
      ref={ref}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ComponentRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content className={cn("py-4.5", className)} ref={ref} {...props} />;
});
