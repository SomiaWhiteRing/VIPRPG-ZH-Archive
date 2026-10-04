import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function DetailPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-w-0 w-[min(1180px,calc(100vw-2rem))] wrap-anywhere pb-11 text-foreground max-[560px]:w-[calc(100%-1.5rem)]">
      {children}
    </main>
  );
}

export function DetailPageLayout({
  compactSidebar = false,
  stretchSidebar = false,
  sidebarPosition = "right",
  main,
  sidebar,
  sidebarLabel,
}: {
  compactSidebar?: boolean;
  stretchSidebar?: boolean;
  sidebarPosition?: "left" | "right";
  main: ReactNode;
  sidebar: ReactNode;
  sidebarLabel: string;
}) {
  return (
    <div className={cn("flex items-start gap-[clamp(24px,3vw,40px)] pt-1 max-[980px]:flex-col", stretchSidebar && "min-[981px]:items-stretch")}>
      <div className="min-w-0 flex-1 max-[980px]:order-1 max-[980px]:w-full">{main}</div>
      <aside
        aria-label={sidebarLabel}
        className={cn(
          "grid shrink-0 content-start gap-3.5 max-[980px]:contents",
          compactSidebar ? "w-[300px]" : "w-[380px]",
          stretchSidebar && "min-[981px]:content-stretch",
          sidebarPosition === "left" && "order-first sticky top-18.5 max-h-[calc(100dvh-5.5rem)] overflow-y-auto pr-1 max-[980px]:max-h-none max-[980px]:overflow-visible",
        )}
      >
        {sidebar}
      </aside>
    </div>
  );
}
