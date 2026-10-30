import { requestJsonValue } from "@/lib/ui/api-response";
import { INBOX_CHANGED_EVENT } from "@/lib/inbox-events";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { useLocation, useRouteLoaderData, useSearchParams } from "react-router";

const InboxUnreadContext = createContext({ unread: 0, messagesUnread: 0 });
export function useInboxUnread() { return useContext(InboxUnreadContext); }

export function InboxIndicator({
  initialUnread,
  initialMessagesUnread,
  enabled,
  children,
}: {
  initialUnread: number;
  initialMessagesUnread: number;
  enabled: boolean;
  children: ReactNode;
}) {
  const pathname = useLocation().pathname;
  const navigationParams = new URLSearchParams(useSearchParams()[0]);
  if (pathname === "/me/permissions") navigationParams.delete("role");
  const query = navigationParams.toString();
  const serverTime = useRouteLoaderData<{ serverTime: number }>("root")?.serverTime;
  const [snapshot, setSnapshot] = useState({
    initial: initialUnread,
    serverTime,
    unread: initialUnread,
    initialMessages: initialMessagesUnread,
    messagesUnread: initialMessagesUnread,
  });
  const mounted = useRef(false);
  const lastSuccess = useRef(0);
  const lastLoader = useRef<number | undefined>(undefined);
  if (snapshot.initial !== initialUnread || snapshot.initialMessages !== initialMessagesUnread || snapshot.serverTime !== serverTime) {
    setSnapshot({ initial: initialUnread, serverTime, unread: initialUnread, initialMessages: initialMessagesUnread, messagesUnread: initialMessagesUnread });
  }

  useEffect(() => {
    if (!enabled) return;
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
        const result = await requestJsonValue<{ unread: number; messagesUnread: number }>("/api/inbox/unread", {
          cache: "no-store",
          signal: controller.signal,
        });
        const unread = result.unread;
        const messagesUnread = result.messagesUnread;
        if (
          !disposed &&
          typeof unread === "number" &&
          Number.isSafeInteger(unread) &&
          unread >= 0 && Number.isSafeInteger(messagesUnread) && messagesUnread >= 0
        ) {
          lastSuccess.current = Date.now();
          setSnapshot((previous) => ({ ...previous, unread, messagesUnread }));
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
    // A fresh root loader already counted unread items, even if the number did
    // not change. Navigations which reuse the loader still refresh normally.
    if (serverTime !== undefined && lastLoader.current !== serverTime) {
      lastLoader.current = serverTime;
      lastSuccess.current = Date.now();
    } else if (mounted.current) void refresh();
    mounted.current = true;
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
  }, [pathname, query, serverTime, enabled]);

  return <InboxUnreadContext.Provider value={snapshot}>{children}</InboxUnreadContext.Provider>;
}
