import { useState } from "react";
import { useMessages } from "@/lib/i18n/react";
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
  const t = useMessages();
  const inputId = `comment-reply-input-${rootId}`;
  return (
    <CommentReplyLayout inputId={inputId} displayName={target.author?.displayName ?? t("comment.deletedUser")} busy={busy} onCancel={onCancel}>
      {unavailable ? <p role="alert" className="text-sm text-destructive">{t("comment.replyTargetDeleted")}</p> : null}
      <CommentComposer endpoint={endpoint} target={target.target} replyToCommentId={target.id} inputId={inputId}
        placeholder={t("comment.replyPlaceholder")} unavailable={unavailable} onCreated={onCreated}
        onBusyChange={(value) => { setBusy(value); onBusyChange(value); }} />
    </CommentReplyLayout>
  );
}
