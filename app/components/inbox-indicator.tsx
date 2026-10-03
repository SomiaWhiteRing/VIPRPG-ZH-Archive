import { requestJson } from "@/lib/ui/api-response";
import { INBOX_CHANGED_EVENT } from "@/lib/inbox-events";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useLocation, useSearchParams } from "react-router";

export function InboxIndicator({
  initialUnread,
  children,
}: {
  initialUnread: number;
  children: (unread: number) => ReactNode;
}) {
  const pathname = useLocation().pathname;
  const navigationParams = new URLSearchParams(useSearchParams()[0]);
  if (pathname === "/me/permissions") navigationParams.delete("role");
  const query = navigationParams.toString();
  const [snapshot, setSnapshot] = useState({
    initial: initialUnread,
    unread: initialUnread,
  });
  const mounted = useRef(false);
  const lastSuccess = useRef(0);
  if (snapshot.initial !== initialUnread) {
    setSnapshot({ initial: initialUnread, unread: initialUnread });
  }

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let queued = false;
    const controller = new AbortController();
    async function refresh(force = false) {
      if (document.visibilityState !== "visible") return;
      if (inFlight) {
        queued ||= force;
        return;
      }
      if (!force && Date.now() - lastSuccess.current < 1000) return;
      inFlight = true;
      try {
        const result = await requestJson<{ unread?: unknown }>("/api/inbox/unread", {
          cache: "no-store",
          signal: controller.signal,
        });
        const unread = result.unread;
        if (
          !disposed &&
          typeof unread === "number" &&
          Number.isSafeInteger(unread) &&
          unread >= 0
        ) {
          lastSuccess.current = Date.now();
          setSnapshot((previous) => ({ ...previous, unread }));
        }
      } catch {
        // Retain the last successful value; the next navigation/focus can retry.
      } finally {
        inFlight = false;
        if (queued && !disposed) {
          queued = false;
          void refresh(true);
        }
      }
    }
    const onFocus = () => {
      void refresh();
    };
    const onChanged = () => {
      void refresh(true);
    };
    if (mounted.current) void refresh();
    else mounted.current = true;
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => {
      disposed = true;
      controller.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
    };
  }, [pathname, query]);

  return children(snapshot.unread);
}
