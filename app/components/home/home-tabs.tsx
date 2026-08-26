"use client";

import { useEffect, useState } from "react";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

const TABS = [
  { id: "recent-updates", label: "最近更新" },
  { id: "about-site", label: "关于本站" },
] as const;

export function HomeTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>(TABS[0].id);

  useEffect(() => {
    const hash = window.location.hash.slice(1) as (typeof TABS)[number]["id"];
    const hashFrame = TABS.some((tab) => tab.id === hash) ? window.requestAnimationFrame(() => setActive(hash)) : null;
    const sections = TABS.map(({ id }) => document.getElementById(id)).filter((section): section is HTMLElement =>
      Boolean(section),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top - 140) - Math.abs(b.boundingClientRect.top - 140))[0];
        if (visible?.target.id) setActive(visible.target.id as (typeof TABS)[number]["id"]);
      },
      { rootMargin: "-130px 0px -55%", threshold: [0.1, 0.4, 0.8] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      if (hashFrame !== null) window.cancelAnimationFrame(hashFrame);
    };
  }, []);

  return (
    <div
      className="sticky top-16 z-20 my-6 flex gap-1 overflow-x-auto backdrop-blur"
      role="tablist"
      aria-label="首页内容"
    >
      {TABS.map((tab) => (
        <Rm2kButton
          aria-selected={active === tab.id}
          className="min-h-10 rounded-sm px-3 text-sm font-bold text-white/90 hover:brightness-110"
          href={`#${tab.id}`}
          key={tab.id}
          onClick={() => setActive(tab.id)}
          role="tab"
        >
          {tab.label}
        </Rm2kButton>
      ))}
    </div>
  );
}
