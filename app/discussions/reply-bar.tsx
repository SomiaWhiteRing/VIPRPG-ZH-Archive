import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { ForumViewer } from "@/lib/forum";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

// Measure the occupied viewport so content and scroll targets clear the bottom bar.
export function ForumReplyBar({
  children,
  viewer,
  onOccupancyChange,
}: {
  children: ReactNode;
  viewer: ForumViewer;
  onOccupancyChange: (occupied: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const placeholder = slot.current;
    const page = placeholder?.closest("[data-forum-page]");
    if (!bar || !placeholder || !page) return;
    let anchor: HTMLElement | null = null;
    const header = document.getElementById("site-header");
    const viewport = window.visualViewport;
    let frame = 0;
    function measure() {
      if (!bar || !placeholder) return;
      const currentAnchor = page?.querySelector<HTMLElement>("#post-1") ?? null;
      if (currentAnchor !== anchor) {
        if (anchor) observer.unobserve(anchor);
        anchor = currentAnchor;
        if (anchor) observer.observe(anchor);
      }
      const top = Math.max(
        viewport?.offsetTop ?? 0,
        header?.getBoundingClientRect().bottom ?? 0,
      );
      const viewBottom =
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const bounds = anchor?.getBoundingClientRect();
      const docked =
        !bounds || bounds.bottom <= top || bounds.top >= viewBottom;
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
      onOccupancyChange(docked ? height + bottom : null);
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
      onOccupancyChange(null);
    };
  }, [onOccupancyChange]);
  return (
    <div ref={slot}>
      <div
        ref={ref}
        data-forum-reply-bar
        className="border-b border-border bg-card data-[docked=true]:fixed data-[docked=true]:inset-x-0 data-[docked=true]:bottom-0 data-[docked=true]:z-40 data-[docked=true]:border-t data-[docked=true]:pb-[env(safe-area-inset-bottom)] data-[docked=true]:shadow-surface"
      >
        <div className="mx-auto flex w-[min(1180px,calc(100%-2rem))] items-start gap-3 py-3">
          {viewer ? (
            <UserAvatar
              displayName={viewer.name}
              avatarBlobSha256={viewer.avatar}
              className="size-8 sm:size-10"
            />
          ) : null}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
