import { Button } from "@/app/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import type { ReactNode } from "react";
import { useId, useState, useSyncExternalStore } from "react";


const desktopQuery = "(min-width: 981px)";
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;

export function CharacterContentTabs({
  works,
  materials,
  workCount,
  materialCount,
  sidebar,
  children,
}: {
  works: ReactNode;
  materials: ReactNode;
  workCount: number;
  materialCount: number;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktop,
    getServerDesktop,
  );
  const [tab, setTab] = useState("works");
  const [manuallyCollapsed, setManuallyCollapsed] = useState<boolean | null>(
    null,
  );
  const collapsed = desktop && (manuallyCollapsed ?? tab === "materials");
  const sidebarId = useId();

  return (
    <div className="group/character grid grid-cols-[300px_minmax(0,1fr)] items-start gap-x-[clamp(24px,3vw,40px)] pt-1 [transition:grid-template-columns_280ms_ease,column-gap_280ms_ease] data-[collapsed=true]:grid-cols-[0px_minmax(0,1fr)] data-[collapsed=true]:gap-x-6 [@media(max-width:980px)]:flex [@media(max-width:980px)]:flex-col [@media(max-width:980px)]:gap-[clamp(24px,3vw,40px)] motion-reduce:transition-none" data-collapsed={collapsed}>
      <div className="sticky top-[74px] min-w-0 [@media(max-width:980px)]:static [@media(max-width:980px)]:w-full">
        <aside
          aria-label="角色资料"
          className="max-h-[calc(100dvh-5.5rem)] overflow-x-hidden overflow-y-auto visible opacity-100 [transition:max-height_280ms_ease,opacity_280ms_ease,visibility_280ms] group-data-[collapsed=true]/character:max-h-0 group-data-[collapsed=true]/character:invisible group-data-[collapsed=true]/character:opacity-0 [@media(max-width:980px)]:max-h-none [@media(max-width:980px)]:overflow-visible motion-reduce:transition-none"
          id={sidebarId}
          inert={collapsed}
        >
          <div className="w-[300px] pr-1 transition-transform duration-[280ms] ease-[ease] group-data-[collapsed=true]/character:[transform:translateX(-100%)] [@media(max-width:980px)]:w-full [@media(max-width:980px)]:pr-0 motion-reduce:transition-none">{sidebar}</div>
        </aside>
        <Button
          aria-controls={sidebarId}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开角色资料" : "收起角色资料"}
          className="absolute top-3 -right-5 z-10 size-10 min-h-0 rounded-full bg-background p-0 [clip-path:inset(-4px)] [transition:clip-path_280ms_ease,background-color_150ms_ease] group-data-[collapsed=true]/character:[clip-path:inset(-4px_-4px_-4px_50%)] [@media(max-width:980px)]:hidden motion-reduce:transition-none"
          onClick={() => setManuallyCollapsed(!collapsed)}
          title={collapsed ? "展开角色资料" : "收起角色资料"}
          type="button"
          variant="outline"
        >
          <span aria-hidden className="size-[7px] border-t-2 border-r-2 border-current [transform:rotate(-135deg)] transition-transform duration-[280ms] ease-[ease] group-data-[collapsed=true]/character:[transform:translateX(8px)_rotate(45deg)] motion-reduce:transition-none" />
        </Button>
      </div>
      <div className="min-w-0 [@media(max-width:980px)]:w-full">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setManuallyCollapsed(null);
          }}
        >
          <TabsList aria-label="角色相关内容">
            {[
              { value: "works", label: "登场作品", count: workCount },
              { value: "materials", label: "素材", count: materialCount },
            ].map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
                <span className="font-mono text-xs">
                  {formatNumber(tab.count)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="works">{works}</TabsContent>
          <TabsContent value="materials">{materials}</TabsContent>
        </Tabs>
        {children}
      </div>
    </div>
  );
}
