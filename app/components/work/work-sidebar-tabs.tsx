"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

type SidebarTab = "comments" | "secondary";

export function WorkSidebarTabs({
  comments,
  commentCount,
  secondary,
  secondaryLabel,
}: {
  comments: ReactNode;
  commentCount: number;
  secondary: ReactNode;
  secondaryLabel: string;
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("comments");

  useEffect(() => {
    function revealHashTarget() {
      const targetId = window.location.hash.slice(1);
      if (targetId !== "comments" && !targetId.startsWith("comment-")) return;

      setActiveTab("comments");
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ block: "nearest" });
      });
    }

    revealHashTarget();
    window.addEventListener("hashchange", revealHashTarget);
    return () => window.removeEventListener("hashchange", revealHashTarget);
  }, []);

  return (
    <Card className="order-2 overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-none max-[980px]:w-full">
      <div aria-label="侧栏内容" className="hidden border-b border-border min-[981px]:flex" role="tablist">
        <SidebarTabButton
          active={activeTab === "comments"}
          controls="work-sidebar-comments"
          onClick={() => setActiveTab("comments")}
        >
          评论 <span className="font-mono text-xs text-muted">{commentCount}</span>
        </SidebarTabButton>
        <SidebarTabButton
          active={activeTab === "secondary"}
          controls="work-sidebar-secondary"
          onClick={() => {
            setActiveTab("secondary");
            if (/^#(?:comments|comment-)/.test(window.location.hash)) {
              window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
            }
          }}
        >
          {secondaryLabel}
        </SidebarTabButton>
      </div>

      <section
        aria-labelledby="work-sidebar-comments-heading"
        className={`p-4.5 ${activeTab === "comments" ? "min-[981px]:block" : "min-[981px]:hidden"}`}
        id="work-sidebar-comments"
        role="tabpanel"
      >
        <h2 className="mb-3.5 text-base font-bold min-[981px]:sr-only" id="work-sidebar-comments-heading">
          评论
        </h2>
        {comments}
      </section>

      <section
        aria-labelledby="work-sidebar-secondary-heading"
        className={`border-t border-border p-4.5 min-[981px]:border-t-0 ${
          activeTab === "secondary" ? "min-[981px]:block" : "min-[981px]:hidden"
        }`}
        id="work-sidebar-secondary"
        role="tabpanel"
      >
        <h2 className="mb-3.5 text-base font-bold min-[981px]:sr-only" id="work-sidebar-secondary-heading">
          {secondaryLabel}
        </h2>
        {secondary}
      </section>
    </Card>
  );
}

function SidebarTabButton({
  active,
  children,
  controls,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  controls: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-controls={controls}
      aria-selected={active}
      className={`min-h-11 flex-1 rounded-none border-b-2 px-3 shadow-none ${
        active
          ? "border-primary bg-transparent text-[#1f6f67] hover:bg-transparent"
          : "border-transparent text-muted hover:border-border hover:bg-transparent hover:text-foreground"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}
