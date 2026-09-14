"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { notifyInboxChanged } from "@/lib/inbox-events";

export function InboxReadOnView({ itemId, topicId, postNumber, commentId }: {
  itemId:number; topicId:number; postNumber:number; commentId:number|null;
}) {
  const [attempt,setAttempt] = useState(0);
  const [error,setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let started = false;
    const controller = new AbortController();
    const read = async () => {
      if (started || document.visibilityState !== "visible") return;
      const target = document.getElementById(commentId ? `comment-${commentId}` : `post-${postNumber}`);
      if (!target) return;
      started = true;
      try {
        const response = await fetch(`/api/inbox/${itemId}/read`,{
          method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},
          body:JSON.stringify({topicId,postNumber,commentId}),signal:controller.signal,
        });
        if (!response.ok) throw new Error("read_failed");
        if (!disposed) { setError(false); notifyInboxChanged(); }
      } catch {
        if (!disposed) setError(true);
      }
    };
    // Effects only run on the displayed client tree, never during RSC prefetch.
    void read();
    document.addEventListener("visibilitychange",read);
    return () => { disposed = true; controller.abort(); document.removeEventListener("visibilitychange",read); };
  },[itemId,topicId,postNumber,commentId,attempt]);
  if (!error) return null;
  return <div role="alert" className="mx-auto flex w-[min(1280px,calc(100%-2rem))] flex-wrap items-center gap-3 pt-4 text-sm">
    <span>未能标记已读，请重试。</span>
    <Button size="sm" variant="outline" onClick={() => {setError(false);setAttempt((value) => value+1);}}>重试</Button>
    <Link href={`/inbox/${itemId}`} className="text-primary hover:underline">查看提醒</Link>
  </div>;
}
