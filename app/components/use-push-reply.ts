import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/** Reply intents focus an existing editor while keeping its current draft. */
export function usePushReply() {
  const location = useLocation();
  const [intent, setIntent] = useState<{ locationKey: string; value: string; key: string } | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function receive(event: MessageEvent) {
      if (event.data?.type !== "viprpg-push-reply" || typeof event.data.url !== "string") return;
      const url = new URL(event.data.url);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      const value = url.searchParams.get("pushReply");
      if (value && /^[1-9]\d*$/.test(value)) setIntent({ locationKey: location.key, value, key: String(Date.now()) });
    }
    navigator.serviceWorker.addEventListener("message", receive);
    return () => navigator.serviceWorker.removeEventListener("message", receive);
  }, [location.key]);
  return intent?.locationKey === location.key ? intent
    : { value: new URLSearchParams(location.search).get("pushReply"), key: location.key };
}
