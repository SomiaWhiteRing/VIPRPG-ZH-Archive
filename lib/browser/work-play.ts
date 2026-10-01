// All acquisition/play actions share the server's per-work identity counter.
export function reportWorkPlayed(workId: number): void {
  void fetch(`/api/works/${workId}/played`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
