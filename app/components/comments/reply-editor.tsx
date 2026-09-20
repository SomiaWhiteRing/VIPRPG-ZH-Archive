import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import type { CommentDto } from "@/lib/dto/db/work-community";
import { CommentComposer } from "./composer";

export function CommentReplyEditor({ endpoint, rootId, target, unavailable, onBusyChange, onCancel, onCreated }: {
  endpoint: string;
  rootId: number;
  target: CommentDto;
  unavailable: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onCreated: (reply: CommentDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputId = `comment-reply-input-${rootId}`;
  return (
    <div className="mt-3 grid min-w-0 gap-2" aria-label="楼内回复">
      <div className="flex items-center gap-2 text-sm">
        <Label className="text-xs font-semibold text-muted" htmlFor={inputId}>回复 {target.author?.displayName ?? "已删除用户"}</Label>
        <Button disabled={busy} type="button" variant="ghost" size="sm" onClick={onCancel}>取消</Button>
      </div>
      {unavailable ? <p role="alert" className="text-sm text-destructive">回复目标已删除，请取消后重新选择。</p> : null}
      <CommentComposer endpoint={endpoint} target={target.target} replyToCommentId={target.id} inputId={inputId}
        placeholder="写下回复……" unavailable={unavailable} onCreated={onCreated}
        onBusyChange={(value) => { setBusy(value); onBusyChange(value); }} />
    </div>
  );
}
