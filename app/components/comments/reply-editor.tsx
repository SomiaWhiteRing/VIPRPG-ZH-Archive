import { useState } from "react";
import type { CommentDto } from "@/lib/dto/db/work-community";
import { CommentComposer } from "./composer";
import { CommentReplyLayout } from "./composer-layout";

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
    <CommentReplyLayout inputId={inputId} displayName={target.author?.displayName ?? "已删除用户"} busy={busy} onCancel={onCancel}>
      {unavailable ? <p role="alert" className="text-sm text-destructive">回复目标已删除，请取消后重新选择。</p> : null}
      <CommentComposer endpoint={endpoint} target={target.target} replyToCommentId={target.id} inputId={inputId}
        placeholder="写下回复……" unavailable={unavailable} onCreated={onCreated}
        onBusyChange={(value) => { setBusy(value); onBusyChange(value); }} />
    </CommentReplyLayout>
  );
}
