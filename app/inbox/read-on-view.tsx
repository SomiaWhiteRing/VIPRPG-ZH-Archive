import { requestJson } from "@/lib/ui/api-response";

import { Button } from "@/app/components/ui/button";
import { notifyInboxChanged } from "@/lib/inbox-events";
import type { InboxReadTarget } from "@/lib/dto/db/inbox";
import { useEffect, useState } from "react";
import { Link } from "react-router";

export function InboxReadOnView({
  itemId,
  ...target
}: {
  itemId: number;
} & InboxReadTarget) {
  const targetId = "eventId" in target
    ? target.replyId === null ? `timeline-event-${target.eventId}` : `timeline-reply-item-${target.replyId}`
    : target.commentId ? `comment-${target.commentId}` : `post-${target.postNumber}`;
  const body = JSON.stringify(target);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let started = false;
    const controller = new AbortController();
    const read = async () => {
      if (started || document.visibilityState !== "visible") return;
      const target = document.getElementById(targetId);
      if (!target) return;
      started = true;
      try {
        await requestJson(`/api/inbox/${itemId}/read`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });

        if (!disposed) {
          setError(false);
          notifyInboxChanged();
        }
      } catch {
        if (!disposed) setError(true);
      }
    };
    // Effects only run on the displayed client tree, never during RSC prefetch.
    void read();
    document.addEventListener("visibilitychange", read);
    return () => {
      disposed = true;
      controller.abort();
      document.removeEventListener("visibilitychange", read);
    };
  }, [itemId, targetId, body, attempt]);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mx-auto flex w-[min(1280px,calc(100%-2rem))] flex-wrap items-center gap-3 pt-4 text-sm"
    >
      <span>未能标记已读，请重试。</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setError(false);
          setAttempt((value) => value + 1);
        }}
      >
        重试
      </Button>
      <Link to={`/inbox/${itemId}`} className="text-primary hover:underline">
        查看提醒
      </Link>
    </div>
  );
}
