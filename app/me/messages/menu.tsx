import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useState } from "react";
import { EllipsisVertical } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/app/components/ui/alert-dialog";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import type { MessagePeer } from "@/lib/dto/db/messages";
import { FORUM_REPORT_REASONS, reportReasonKeys } from "@/lib/forum";
import type { RestrictedInteraction } from "@/lib/interaction-restrictions";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { UserBlockDialog } from "@/app/components/user-block-settings";
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";

export function MessageMenu({ peer, interactionRestrictions, onChanged }: {
  peer: MessagePeer; interactionRestrictions: RestrictedInteraction[] | null; onChanged: () => Promise<void>;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const [blocking, setBlocking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  const hidePosts = useIsPostAuthorHidden()(peer.id);
  return <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" aria-label={t("forum.menu.more")}><EllipsisVertical aria-hidden /></Button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-48 rounded-md border border-border bg-card p-1 shadow-surface">
        <DropdownMenu.Item className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none focus:bg-primary/10" onSelect={() => setBlocking(true)}>
          {t("messages.blockSettings")}
        </DropdownMenu.Item>
        <DropdownMenu.Item className="cursor-pointer rounded-sm px-3 py-2 text-sm text-destructive outline-none focus:bg-primary/10" onSelect={() => setReporting(true)}>{t("messages.reportUser")}</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    {blocking ? <UserBlockDialog peer={peer} initial={{ ...peer.blockSettings, hidePosts }} interactionRestrictions={interactionRestrictions}
      onClose={() => setBlocking(false)} onSaved={() => { void onChanged().catch(error => toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("messages.loadFailed"))); }} /> : null}
    {reporting ? <MessageReportDialog peer={peer} onClose={() => setReporting(false)} /> : null}
  </>;
}

function MessageReportDialog({ peer, onClose }: { peer: MessagePeer; onClose: () => void }) {
  const t = useMessages();
  const locale = useUiLocale();
  const [reason, setReason] = useState<string>(FORUM_REPORT_REASONS[0]);
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit() {
    setBusy(true);
    try {
      await requestJson(`/api/messages/${peer.id}/report?${UI_LOCALE_PARAM}=${locale}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, explanation }) }, t("messages.reportFailed"));
      onClose();
    } catch (error) { toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("messages.reportFailed")); }
    finally { setBusy(false); }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogTitle className="text-lg font-bold">{t("messages.reportUser")}</AlertDialogTitle>
      <AlertDialogDescription className="text-sm text-muted">{peer.displayName}</AlertDialogDescription>
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div><Label htmlFor="message-report-reason">{t("forum.action.reason")}</Label><SelectField id="message-report-reason" value={reason} onValueChange={setReason} disabled={busy} options={FORUM_REPORT_REASONS.map(value => ({ value, label: t(reportReasonKeys[value]) }))} /></div>
        <div><Label htmlFor="message-report-explanation">{t("forum.action.explain")}</Label><Textarea id="message-report-explanation" value={explanation} onChange={event => setExplanation(event.target.value)} maxLength={2000} required={reason === "其他"} disabled={busy} /></div>
        <div className="flex justify-end gap-2"><AlertDialogCancel asChild><Button type="button" variant="outline" disabled={busy}>{t("play.save.cancel")}</Button></AlertDialogCancel><Button type="submit" disabled={busy}>{t("admin.discussionTags.confirm")}</Button></div>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
