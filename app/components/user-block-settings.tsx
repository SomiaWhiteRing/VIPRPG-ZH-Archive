import { useEffect, useId, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import * as Dialog from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useToast } from "@/app/components/ui/toast";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { requestJson } from "@/lib/ui/api-response";
import { USER_BLOCK_OPTIONS, userBlockState, type UserBlockSettings } from "@/lib/user-blocks";

type Peer = { id: number; displayName: string; avatarBlobSha256: string | null };

export function UserBlockButton({ peer, initial, onSaved }: {
  peer: Peer; initial: UserBlockSettings; onSaved?: (settings: UserBlockSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [open, setOpen] = useState(false);
  useEffect(() => setSettings(initial), [initial]);
  const state = userBlockState(settings);
  const label = `屏蔽设置：${state === "none" ? "未屏蔽" : state === "partial" ? "部分屏蔽" : "全部屏蔽"}`;
  return <>
    <Button type="button" size="sm" variant={state === "all" ? "default" : "outline"}
      className={state === "partial" ? "w-9 bg-primary/10 px-0 text-primary" : "w-9 px-0"}
      aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {state === "all" ? <BellOff aria-hidden /> : state === "partial" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path fill="currentColor" stroke="none" d="M12 3a6 6 0 0 0-6 6c0 7-3 7-3 9h9Z" />
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg> : <Bell aria-hidden />}
    </Button>
    {open ? <UserBlockDialog peer={peer} initial={settings} onClose={() => setOpen(false)} onSaved={next => {
      setSettings(next); onSaved?.(next);
    }} /> : null}
  </>;
}

export function UserBlockDialog({ peer, initial, onClose, onSaved }: {
  peer: Peer; initial: UserBlockSettings; onClose: () => void; onSaved: (settings: UserBlockSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const toast = useToast();
  const all = userBlockState(settings) === "all";
  async function save() {
    setBusy(true);
    try {
      const response = await requestJson<{ ok: true; settings: UserBlockSettings }>(`/api/users/${peer.id}/block-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      notifyInboxChanged();
      onSaved(response.settings);
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay />
      <Dialog.Content aria-describedby={undefined} className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5">
        <Dialog.Title>屏蔽设置</Dialog.Title>
        <div className="flex min-w-0 items-center gap-3"><UserAvatar avatarBlobSha256={peer.avatarBlobSha256} displayName={peer.displayName} size={32} /><span className="truncate font-semibold">{peer.displayName}</span></div>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (!busy) void save(); }}>
          <div className="grid gap-1">{USER_BLOCK_OPTIONS.map(option => <Label key={option.key} htmlFor={`${id}-${option.key}`} className="flex cursor-pointer items-center justify-between gap-4 rounded-md py-2">
            {option.label}<Checkbox id={`${id}-${option.key}`} checked={settings[option.key]} disabled={busy}
              onCheckedChange={value => setSettings(previous => ({ ...previous, [option.key]: value === true }))} />
          </Label>)}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="mr-auto" disabled={busy}
              onClick={() => setSettings({ blockPrivateMessages: !all, muteComments: !all, muteReplies: !all, muteLikes: !all, muteFriends: !all })}>{all ? "全部取消" : "全部屏蔽"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={busy}>保存</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
