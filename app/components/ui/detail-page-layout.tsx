import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function DetailPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] pb-11 text-foreground max-[560px]:w-[calc(100%-1.5rem)]">
      {children}
    </main>
  );
}

export function DetailPageLayout({
  compactSidebar = false,
  main,
  sidebar,
  sidebarLabel,
}: {
  compactSidebar?: boolean;
  main: ReactNode;
  sidebar: ReactNode;
  sidebarLabel: string;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-[clamp(24px,3vw,40px)] pt-1 max-[980px]:flex max-[980px]:flex-col",
        compactSidebar
          ? "grid-cols-[minmax(0,1fr)_300px]"
          : "grid-cols-[minmax(0,1fr)_380px]",
      )}
    >
      <div className="min-w-0 max-[980px]:order-1 max-[980px]:w-full">{main}</div>
      <aside
        aria-label={sidebarLabel}
        className="sticky top-18.5 grid max-h-[calc(100dvh-5.5rem)] content-start gap-3.5 overflow-y-auto pr-1 max-[980px]:contents max-[980px]:overflow-visible"
      >
        {sidebar}
      </aside>
    </div>
  );
}
