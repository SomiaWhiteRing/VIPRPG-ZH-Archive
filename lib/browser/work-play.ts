import { requestOk } from "@/lib/ui/api-response";

// All acquisition/play actions share the server's per-work identity counter.
export function reportWorkPlayed(workId: number): void {
  void requestOk(`/api/works/${workId}/played`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

// Called only after the engine is ready, including the APK's offline player.
// The server owns per-account first-play deduplication and timeline preferences.
// Do not cache or gate this on the timeline switch: playing while it is off
// still consumes eligibility. Offline/failed requests are not replayed later
// under a possibly different account or with an invented first-play time.
export function reportFirstWorkPlay(workId: number): void {
  void requestOk(`/api/works/${workId}/first-play`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
