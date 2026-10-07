import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { type SiteAnalyticsConfig } from "@/lib/analytics";
import { pauseAnalytics, synchronizeAnalytics, trackAnalytics, trackAnalyticsPage } from "@/lib/browser/site-analytics";

export function SiteAnalytics({ config, embedded }: { config: SiteAnalyticsConfig | null; embedded: boolean }) {
  const { pathname, search, key } = useLocation();
  const scrollState = useRef({ key: "", reached: new Set<number>() });

  useEffect(() => {
    if (!synchronizeAnalytics(embedded ? null : config)) {
      scrollState.current = { key: "", reached: new Set<number>() };
      return;
    }
    const pageKey = `${key}:${pathname}${search}`;
    trackAnalyticsPage(pageKey);
    if (scrollState.current.key !== pageKey) scrollState.current = { key: pageKey, reached: new Set<number>() };
    const { reached } = scrollState.current;
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const height = document.documentElement.scrollHeight;
        if (height <= window.innerHeight) return;
        const percent = (window.scrollY + window.innerHeight) / height * 100;
        for (const threshold of [25, 50, 90]) if (percent >= threshold && !reached.has(threshold)) {
          reached.add(threshold); trackAnalytics("scroll_depth", { scroll_percent: threshold });
        }
      });
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { pauseAnalytics(); cancelAnimationFrame(frame); window.removeEventListener("scroll", scroll); };
  }, [config, embedded, key, pathname, search]);

  return null;
}
