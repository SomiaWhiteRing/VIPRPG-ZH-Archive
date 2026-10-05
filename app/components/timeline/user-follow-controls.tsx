import { requestJson } from "@/lib/ui/api-response";

import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import type { FollowSummary } from "@/lib/dto/db/user-follows";
import { notifyInboxChanged } from "@/lib/inbox-events";

export function UserFollowControls({ userId, displayName, viewerId, summary }: { userId: number; displayName: string; viewerId: number | null; summary: FollowSummary | null }) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const revalidator = useRevalidator();
  const toast = useToast();
  const confirm = useConfirm();
  async function save(following: boolean) {
    setBusy(true);
    try {
      await requestJson(`/api/users/${userId}/follow`, { method: following ? "PUT" : "DELETE" });
      notifyInboxChanged();
      await revalidator.revalidate();
    } finally { setBusy(false); }
  }
  async function toggle() {
    if (!summary || submitting.current) return;
    submitting.current = true;
    try {

      if (summary.isFollowing) await confirm(`要将${displayName}移出好友列表吗`, {
        title: "解除好友", confirmLabel: "解除好友", destructive: true, action: () => save(false),
      });
      else await save(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "好友操作未完成，请重试。");
    } finally { submitting.current = false; }
  }
  if (!summary || viewerId === userId) return null;
  return <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
    {!viewerId ? <Button asChild size="sm"><Link to={`/login?next=${encodeURIComponent(`/users/${userId}`)}`}>加为好友</Link></Button> :
      <Button type="button" size="sm" variant={summary.isFollowing ? "outline" : "default"}
        disabled={busy || (summary.isFollowing ? !summary.canUnfollow : !summary.canFollow)} onClick={() => void toggle()}>
        {busy ? "正在保存…" : summary.isFollowing ? "解除好友" : "加为好友"}
      </Button>}
  </div>;
}
