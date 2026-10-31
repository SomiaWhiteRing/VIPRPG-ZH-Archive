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
import { FORUM_REPORT_REASONS } from "@/lib/forum";
import { requestJson } from "@/lib/ui/api-response";

export function MessageMenu({ peer, onChanged }: { peer: MessagePeer; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  async function toggleReceiving() {
    setBusy(true);
    try {
      await requestJson(`/api/messages/${peer.id}/receiving`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receive: !peer.receiveMessages }) });
      await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  return <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" aria-label="更多操作" disabled={busy}><EllipsisVertical aria-hidden /></Button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-48 rounded-md border border-border bg-card p-1 shadow-surface">
        <DropdownMenu.Item className="cursor-pointer rounded-sm px-3 py-2 text-sm outline-none focus:bg-primary/10" onSelect={() => void toggleReceiving()}>
          {peer.receiveMessages ? "不再接收此用户的信息" : "重新接收此用户的信息"}
        </DropdownMenu.Item>
        <DropdownMenu.Item className="cursor-pointer rounded-sm px-3 py-2 text-sm text-destructive outline-none focus:bg-primary/10" onSelect={() => setReporting(true)}>举报用户</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    {reporting ? <MessageReportDialog peer={peer} onClose={() => setReporting(false)} /> : null}
  </>;
}

function MessageReportDialog({ peer, onClose }: { peer: MessagePeer; onClose: () => void }) {
  const [reason, setReason] = useState<string>(FORUM_REPORT_REASONS[0]);
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit() {
    setBusy(true);
    try {
      await requestJson(`/api/messages/${peer.id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, explanation }) });
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogTitle className="text-lg font-bold">举报用户</AlertDialogTitle>
      <AlertDialogDescription className="text-sm text-muted">{peer.displayName}</AlertDialogDescription>
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div><Label htmlFor="message-report-reason">原因</Label><SelectField id="message-report-reason" value={reason} onValueChange={setReason} disabled={busy} options={FORUM_REPORT_REASONS.map(value => ({ value, label: value }))} /></div>
        <div><Label htmlFor="message-report-explanation">说明</Label><Textarea id="message-report-explanation" value={explanation} onChange={event => setExplanation(event.target.value)} maxLength={2000} required={reason === "其他"} disabled={busy} /></div>
        <div className="flex justify-end gap-2"><AlertDialogCancel asChild><Button type="button" variant="outline" disabled={busy}>取消</Button></AlertDialogCancel><Button type="submit" disabled={busy}>确认</Button></div>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
