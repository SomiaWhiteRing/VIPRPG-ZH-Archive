import { useEffect } from "react";
import { viewDay, type ViewKind } from "@/lib/view-stats";

let day = viewDay();
const sent = new Set<string>();

// This is only a per-document traffic optimization. The DO remains authoritative
// across reloads, tabs, detail/play pages and forum pagination.
export function useContentView(kind: ViewKind, id?: number) {
  useEffect(() => {
    if (!id) return;
    const key = `${kind}:${id}`;
    function record() {
      if (document.visibilityState !== "visible") return;
      const today = viewDay();
      if (day !== today) { sent.clear(); day = today; }
      if (sent.has(key)) return;
      if (sent.size >= 1024) sent.delete(sent.values().next().value!);
      sent.add(key);
      const sentDay = day;
      const endpoint = kind === "work" ? `/api/works/${id}/view` : "/api/discussions";
      void fetch(endpoint, {
        method: "POST", credentials: "same-origin", keepalive: true,
        ...(kind === "topic" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "view", topicId: id }),
        } : {}),
      }).then((response) => {
        if (!response.ok) throw new Error("View report failed");
      }).catch(() => { if (day === sentDay) sent.delete(key); });
    }
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [kind, id]);
}
