"use client";

import { useEffect } from "react";

export function WorkViewTracker({ workId }: { workId: number }) {
  useEffect(() => {
    void fetch(`/api/works/${workId}/view`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [workId]);

  return null;
}
