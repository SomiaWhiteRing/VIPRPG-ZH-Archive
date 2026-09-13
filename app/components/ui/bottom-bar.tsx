"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

// Measure the occupied viewport so content and scroll targets clear the bottom bar.
export function BottomBar({ children, anchorId }: { children: ReactNode; anchorId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const placeholder = slot.current;
    if (!bar || !placeholder) return;
    let anchor: HTMLElement | null = null;
    const header = document.querySelector("header");
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const originalPadding = root.style.scrollPaddingBottom;
    const originalClearance = root.style.getPropertyValue("--forum-reply-clearance");
    let frame = 0;
    function measure() {
      if (!bar || !placeholder) return;
      const currentAnchor = anchorId ? document.getElementById(anchorId) : null;
      if (currentAnchor !== anchor) {
        if (anchor) observer.unobserve(anchor);
        anchor = currentAnchor;
        if (anchor) observer.observe(anchor);
      }
      const top = Math.max(viewport?.offsetTop ?? 0, header?.getBoundingClientRect().bottom ?? 0);
      const viewBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const bounds = anchor?.getBoundingClientRect();
      const docked = !bounds || bounds.bottom <= top || bounds.top >= viewBottom;
      bar.dataset.docked = String(docked);
      const bottom = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      bar.style.bottom = docked ? `${bottom}px` : "";
      bar.style.setProperty(
        "--reply-viewport",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      const height = Math.ceil(bar.getBoundingClientRect().height);
      // Keep the same document slot when docking, so scrolling cannot oscillate.
      placeholder.style.height = anchor ? `${height}px` : "0px";
      const occupied = docked ? height + bottom : 0;
      root.style.scrollPaddingBottom = docked ? `${occupied + 16}px` : originalPadding;
      root.style.setProperty("--forum-reply-clearance", `${occupied}px`);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(bar);
    if (placeholder.parentElement) observer.observe(placeholder.parentElement);
    if (header) observer.observe(header);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      root.style.scrollPaddingBottom = originalPadding;
      if (originalClearance) root.style.setProperty("--forum-reply-clearance", originalClearance);
      else root.style.removeProperty("--forum-reply-clearance");
    };
  }, [anchorId]);
  return (
    <div ref={slot}>
      <div
        ref={ref}
        data-forum-reply-bar
        className="border-b border-border bg-card data-[docked=true]:fixed data-[docked=true]:inset-x-0 data-[docked=true]:bottom-0 data-[docked=true]:z-40 data-[docked=true]:border-t data-[docked=true]:pb-[env(safe-area-inset-bottom)] data-[docked=true]:shadow-surface"
      >
        {children}
      </div>
    </div>
  );
}
