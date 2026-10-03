import { requestOk } from "@/lib/ui/api-response";

// All acquisition/play actions share the server's per-work identity counter.
export function reportWorkPlayed(workId: number): void {
  void requestOk(`/api/works/${workId}/played`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
