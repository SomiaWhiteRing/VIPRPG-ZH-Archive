import type { ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { useMessages } from "@/lib/i18n/react";

export function CommentComposerToolbar({ tools, actions }: { tools: ReactNode; actions: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-1">{tools}</div>
    <div className="flex items-center gap-2">{actions}</div>
  </div>;
}

export function CommentReplyLayout({ inputId, displayName, busy, onCancel, children }: {
  inputId: string; displayName: string; busy: boolean; onCancel: () => void; children: ReactNode;
}) {
  const t = useMessages();
  return <div className="mt-3 grid min-w-0 gap-2" aria-label={t("comment.nestedReply")}>
    <div className="flex items-center gap-2 text-sm">
      <Label className="min-w-0 wrap-anywhere text-xs font-semibold text-muted" htmlFor={inputId}>{t("comment.replyToLabel", { name: displayName })}</Label>
      <Button disabled={busy} type="button" variant="ghost" size="sm" onClick={onCancel}>{t("relation.edit.cancel")}</Button>
    </div>
    {children}
  </div>;
}
