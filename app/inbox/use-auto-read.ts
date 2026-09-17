import type { InboxItem } from "@/lib/dto/db/inbox";
import { notifyInboxChanged } from "@/lib/inbox-events";
import type { RefObject } from "react";
import { useEffect, useState } from "react";

export function useInboxAutoRead(
  item: Pick<InboxItem, "id" | "readAt" | "canApprove" | "canReject">,
  targetRef: RefObject<HTMLElement | null>,
  onRead?: (itemId: number) => void,
) {
  const { id, canApprove, canReject } = item;
  const [result, setResult] = useState<{
    itemId: number;
    readAt: string | null;
    error: boolean;
  } | null>(null);
  const readAt = item.readAt ?? (result?.itemId === id ? result.readAt : null);

  useEffect(() => {
    const target = targetRef.current;
    if (readAt || canApprove || canReject || !target) return;

    let disposed = false;
    let visible = false;
    let started = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const clearTimer = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const read = async () => {
      if (started || !visible || document.visibilityState !== "visible") return;
      started = true;
      try {
        const response = await fetch(`/api/inbox/${id}/read`, {
          method: "POST",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("read_failed");
        if (!disposed) {
          setResult({ itemId: id, readAt: new Date().toISOString(), error: false });
          onRead?.(id);
          notifyInboxChanged();
        }
      } catch {
        if (!disposed) setResult({ itemId: id, readAt: null, error: true });
      }
    };
    const schedule = () => {
      clearTimer();
      if (!started && visible && document.visibilityState === "visible") {
        timer = window.setTimeout(() => void read(), 1000);
      }
    };
    // Ignore prefetches, background tabs and rows briefly passed while scrolling.
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      },
      { rootMargin: "-64px 0px 0px 0px" },
    );
    observer.observe(target);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      clearTimer();
      controller.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [id, readAt, canApprove, canReject, targetRef, onRead]);

  return {
    readAt,
    error: !readAt && result?.itemId === id && result.error,
  };
}
