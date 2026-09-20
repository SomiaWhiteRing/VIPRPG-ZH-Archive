import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { ForumViewer } from "@/lib/forum";
import type { ReactNode } from "react";
import { createContext, useEffect, useLayoutEffect, useRef, useState } from "react";

export const ForumReplyFullscreenContext = createContext<{
  fullscreen: boolean;
  setFullscreen: (value: boolean) => void;
} | null>(null);

// Measure the occupied viewport so content and scroll targets clear the bottom bar.
export function ForumReplyBar({
  children,
  viewer,
  onBottomOverscroll,
}: {
  children: ReactNode;
  viewer: ForumViewer;
  onBottomOverscroll?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenMode = useRef({ active: false, restoring: false });
  const scheduleMeasurement = useRef(() => {});
  const finishAnimation = useRef(() => {});
  useLayoutEffect(() => {
    fullscreenMode.current = {
      active: fullscreen,
      restoring: !fullscreen && fullscreenMode.current.active,
    };
    finishAnimation.current();
    scheduleMeasurement.current();
  }, [fullscreen]);
  useLayoutEffect(() => {
    const wrapper = surface.current;
    const inner = content.current;
    if (!wrapper || !inner) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let height = inner.getBoundingClientRect().height;
    let animation: Animation | null = null;
    const finish = () => {
      animation?.cancel();
      animation = null;
      wrapper.style.overflow = "";
    };
    finishAnimation.current = () => {
      finish();
      height = inner.getBoundingClientRect().height;
    };
    const observer = new ResizeObserver(() => {
      const nextHeight = inner.getBoundingClientRect().height;
      if (Math.abs(nextHeight - height) < 0.5) return;
      // Resume from the visible height when a second toggle interrupts a tween.
      const previousHeight = animation
        ? wrapper.getBoundingClientRect().height
        : height;
      height = nextHeight;
      finish();
      if (
        reducedMotion.matches ||
        fullscreenMode.current.active ||
        fullscreenMode.current.restoring
      )
        return;
      wrapper.style.overflow = "clip";
      animation = wrapper.animate(
        [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
        { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
      );
      animation.onfinish = finish;
    });
    observer.observe(inner);
    reducedMotion.addEventListener("change", finish);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", finish);
      finish();
    };
  }, []);
  useEffect(() => {
    if (!onBottomOverscroll) return;
    const desktop = window.matchMedia(
      "(min-width: 768px) and (hover: hover) and (pointer: fine)",
    );
    let opened = false;
    function handleWheel(event: WheelEvent) {
      if (
        opened ||
        !desktop.matches ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.shiftKey ||
        event.deltaY <= 0 ||
        Math.abs(event.deltaX) > event.deltaY
      )
        return;
      const root = document.scrollingElement;
      if (!root || root.scrollHeight - root.clientHeight - root.scrollTop > 2)
        return;
      // A wheel gesture inside a dialog or nested scroller belongs to that UI.
      let target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="menu"], [aria-modal="true"]'))
        return;
      while (target && target !== root) {
        const overflow = getComputedStyle(target).overflowY;
        if (
          /^(auto|scroll|hidden|clip)$/.test(overflow) &&
          target.scrollHeight > target.clientHeight
        )
          return;
        target = target.parentElement;
      }
      // Check before the wheel's default scroll: reaching the bottom alone
      // must not open the editor until another downward gesture arrives.
      opened = true;
      onBottomOverscroll?.();
    }
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [onBottomOverscroll]);
  useLayoutEffect(() => {
    const bar = ref.current;
    const placeholder = slot.current;
    const page = placeholder?.closest<HTMLElement>("[data-forum-page]");
    if (!bar || !placeholder || !page) return;
    const root = document.documentElement;
    const originalScrollPadding = root.style.scrollPaddingBottom;
    let previousOccupancy: number | null = null;
    let anchor: HTMLElement | null = null;
    const header = document.getElementById("site-header");
    const viewport = window.visualViewport;
    let frame = 0;
    function measure() {
      if (!bar || !placeholder || !page) return;
      if (fullscreenMode.current.active) return;
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
      if (bar.dataset.docked !== String(docked))
        bar.dataset.docked = String(docked);
      const bottom = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      const bottomStyle = docked ? `${bottom}px` : "";
      if (bar.style.bottom !== bottomStyle) bar.style.bottom = bottomStyle;
      const viewportHeight = `${viewport?.height ?? window.innerHeight}px`;
      if (bar.style.getPropertyValue("--reply-viewport") !== viewportHeight)
        bar.style.setProperty("--reply-viewport", viewportHeight);
      const height = Math.ceil(bar.getBoundingClientRect().height);
      // A docked bar grows into the viewport, not into its old document slot.
      // Keep that slot stable so it cannot push the reading position down while
      // the bottom clearance moves it up by the same animated height change.
      const slotHeight = !anchor
        ? "0px"
        : !docked || !placeholder.style.height
          ? `${height}px`
          : placeholder.style.height;
      const occupied = docked ? height + bottom : null;
      const previous = previousOccupancy;
      const preserveScroll = fullscreenMode.current.restoring;
      fullscreenMode.current.restoring = false;
      // Read before changing document height, which can clamp the scroll at the
      // bottom. Geometry updates stay outside React so posts don't render on
      // every animation frame.
      const scrollTop = window.scrollY;
      if (placeholder.style.height !== slotHeight)
        placeholder.style.height = slotHeight;
      if (occupied === previous && !preserveScroll) return;
      previousOccupancy = occupied;
      root.style.setProperty("--page-bottom-occlusion", `${occupied ?? 0}px`);
      if (occupied === null) {
        root.style.scrollPaddingBottom = originalScrollPadding;
        page.style.removeProperty("--forum-reply-clearance");
        return;
      }
      // Fullscreen restoration must not shorten the document underneath a
      // reader at the bottom after text was deleted in the editor.
      const clearance = preserveScroll ? Math.max(previous ?? 0, occupied) : occupied;
      page.style.setProperty("--forum-reply-clearance", `${clearance}px`);
      root.style.scrollPaddingBottom = `${occupied + 16}px`;
      if (!preserveScroll && previous !== null && previous !== occupied) {
        window.scrollTo({
          top: scrollTop + occupied - previous,
          behavior: "instant",
        });
      }
    }
    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    }
    scheduleMeasurement.current = schedule;
    // Batch measurements and scroll compensation together. Deferring writes
    // also avoids feeding clearance changes back into ResizeObserver delivery.
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
      root.style.removeProperty("--page-bottom-occlusion");
      root.style.scrollPaddingBottom = originalScrollPadding;
      page.style.removeProperty("--forum-reply-clearance");
    };
  }, []);
  return (
    <div ref={slot}>
      <div
        ref={ref}
        data-forum-reply-bar
        data-fullscreen={fullscreen}
        className="border-b border-border bg-card data-[fullscreen=true]:relative data-[fullscreen=true]:z-[60] data-[docked=true]:fixed data-[docked=true]:inset-x-0 data-[docked=true]:bottom-0 data-[docked=true]:z-40 data-[docked=true]:data-[fullscreen=true]:z-[60] data-[docked=true]:border-t data-[docked=true]:pb-[env(safe-area-inset-bottom)] data-[docked=true]:has-[[data-mobile-emoji-spacer]]:pb-0 data-[docked=true]:shadow-surface"
      >
        <div ref={surface}>
          <div
            ref={content}
            className="mx-auto flex w-[min(1180px,calc(100%-2rem))] items-start gap-3 py-3 has-[[data-mobile-emoji-spacer]]:pb-0"
          >
            {viewer ? (
              <UserAvatar
                displayName={viewer.name}
                avatarBlobSha256={viewer.avatar}
                className="size-8 sm:size-10"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <ForumReplyFullscreenContext.Provider value={{ fullscreen, setFullscreen }}>
                {children}
              </ForumReplyFullscreenContext.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
