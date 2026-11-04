import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export function HomePageLayout({ main, sidebar, hideSidebarOnMobile = false }: {
  main: ReactNode;
  sidebar: ReactNode;
  hideSidebarOnMobile?: boolean;
}) {
  return (
    <div className="flex flex-col gap-7 min-[561px]:gap-8 min-[981px]:flex-row min-[981px]:gap-[clamp(24px,3vw,40px)]">
      <div className="min-w-0 flex-1">{main}</div>
      <div className={cn("min-w-0 shrink-0 min-[981px]:w-[300px]", hideSidebarOnMobile && "hidden min-[981px]:block")}>
        {sidebar}
      </div>
    </div>
  );
}
