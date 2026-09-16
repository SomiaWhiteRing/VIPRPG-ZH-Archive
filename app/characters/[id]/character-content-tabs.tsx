"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/app/components/ui/tabs";
import { Button } from "@/app/components/ui/button";
import { formatNumber } from "@/lib/format";
import styles from "./character-content-tabs.module.css";

const desktopQuery = "(min-width: 981px)";
function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;

export function CharacterContentTabs({ works, materials, workCount, materialCount, sidebar, children }: {
  works: ReactNode;
  materials: ReactNode;
  workCount: number;
  materialCount: number;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const [tab, setTab] = useState("works");
  const [manuallyCollapsed, setManuallyCollapsed] = useState<boolean | null>(null);
  const collapsed = desktop && (manuallyCollapsed ?? tab === "materials");
  const sidebarId = useId();

  return (
    <div className={styles.layout} data-collapsed={collapsed}>
      <div className={styles.sidebarSlot}>
        <aside aria-label="角色资料" className={styles.sidebar} id={sidebarId} inert={collapsed}>
          <div className={styles.sidebarContent}>{sidebar}</div>
        </aside>
        <Button
          aria-controls={sidebarId}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开角色资料" : "收起角色资料"}
          className={styles.toggle}
          onClick={() => setManuallyCollapsed(!collapsed)}
          title={collapsed ? "展开角色资料" : "收起角色资料"}
          type="button"
          variant="outline"
        ><span aria-hidden className={styles.chevron} /></Button>
      </div>
      <div className={styles.main}>
        <Tabs value={tab} onValueChange={(value) => { setTab(value); setManuallyCollapsed(null); }}>
          <TabsList aria-label="角色相关内容">
            {[{ value: "works", label: "登场作品", count: workCount }, { value: "materials", label: "素材", count: materialCount }].map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}<span className="font-mono text-xs">{formatNumber(tab.count)}</span>
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
