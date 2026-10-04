import { requestJson } from "@/lib/ui/api-response";

import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import type { FollowSummary } from "@/lib/dto/db/user-follows";
import { notifyInboxChanged } from "@/lib/inbox-events";

export function UserFollowControls({ userId, viewerId, summary }: { userId: number; viewerId: number | null; summary: FollowSummary | null }) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const revalidator = useRevalidator();
  const toast = useToast();
  async function toggle() {
    if (!summary || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {

      await requestJson(`/api/users/${userId}/follow`, { method: summary.isFollowing ? "DELETE" : "PUT" });
      notifyInboxChanged();
      await revalidator.revalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "好友操作未完成，请重试。");
    } finally { submitting.current = false; setBusy(false); }
  }
  if (!summary || viewerId === userId) return null;
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
    {viewerId && (summary.isFollowing || summary.isFollowedBy) ? <span className="text-xs text-muted">
      {summary.isFollowing ? summary.isFollowedBy ? "互为好友" : "已加为好友" : "已把你加为好友"}
    </span> : null}
    {!viewerId ? <Button asChild size="sm"><Link to={`/login?next=${encodeURIComponent(`/users/${userId}`)}`}>加为好友</Link></Button> :
      <Button type="button" size="sm" variant={summary.isFollowing ? "outline" : "default"}
        disabled={busy || (summary.isFollowing ? !summary.canUnfollow : !summary.canFollow)} onClick={() => void toggle()}>
        {busy ? "正在保存…" : summary.isFollowing ? summary.canUnfollow ? "取消好友" : "已加为好友" : "加为好友"}
      </Button>}
  </div>;
}
