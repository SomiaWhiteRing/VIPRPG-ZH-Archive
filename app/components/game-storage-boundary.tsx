import { cleanupExpiredGameResources } from "@/app/play/[archiveVersionId]/web-play-cleanup";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { isAndroidClient } from "@/lib/browser/client-environment";

export function GameStorageBoundary() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (isAndroidClient()) return;
    const cleanup = () => {
      if (!document.hidden) void cleanupExpiredGameResources().catch(() => {});
    };
    cleanup();
    window.addEventListener("pageshow", cleanup);
    document.addEventListener("visibilitychange", cleanup);
    const timer = window.setInterval(cleanup, 60_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", cleanup);
      document.removeEventListener("visibilitychange", cleanup);
    };
  }, [pathname]);
  return null;
}
