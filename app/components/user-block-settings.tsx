import { useEffect, useId, useState } from "react";
import { Ban, CircleMinus, SlidersHorizontal } from "lucide-react";
import { useRevalidator } from "react-router";
import * as Dialog from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useToast } from "@/app/components/ui/toast";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { INTERACTION_RESTRICTIONS, type RestrictedInteraction } from "@/lib/interaction-restrictions";
import { requestJson } from "@/lib/ui/api-response";
import { USER_BLOCK_OPTIONS, userBlockState, type UserBlockSettings } from "@/lib/user-blocks";

type Peer = { id: number; displayName: string; avatarBlobSha256: string | null };

export function UserBlockButton({ peer, initial, interactionRestrictions }: {
  peer: Peer; initial: UserBlockSettings; interactionRestrictions: RestrictedInteraction[] | null;
}) {
  const [settings, setSettings] = useState(initial);
  const [open, setOpen] = useState(false);
  useEffect(() => setSettings(initial), [initial]);
  const state = userBlockState(settings);
  const label = `屏蔽设置：${state === "none" ? "未屏蔽" : state === "partial" ? "部分屏蔽" : "全部屏蔽"}`;
  return <>
    <Button type="button" size="sm" variant="outline"
      className={`w-9 px-0 ${state === "all"
        ? "border-[color-mix(in_srgb,var(--color-destructive)_55%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-destructive)_10%,var(--color-card))] text-destructive hover:border-destructive hover:text-destructive"
        : state === "partial" ? "text-accent hover:border-accent hover:text-accent"
          : "hover:border-foreground hover:text-foreground"}`}
      aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {state === "all" ? <Ban aria-hidden /> : state === "partial" ? <CircleMinus aria-hidden /> : <SlidersHorizontal aria-hidden />}
    </Button>
    {open ? <UserBlockDialog peer={peer} initial={settings} interactionRestrictions={interactionRestrictions}
      onClose={() => setOpen(false)} onSaved={setSettings} /> : null}
  </>;
}

export function UserBlockDialog({ peer, initial, interactionRestrictions, onClose, onSaved }: {
  peer: Peer; initial: UserBlockSettings; interactionRestrictions: RestrictedInteraction[] | null;
  onClose: () => void; onSaved: (settings: UserBlockSettings) => void;
}) {
  const [baseline] = useState(() => ({ settings: initial, restrictions: interactionRestrictions ?? [] }));
  const [settings, setSettings] = useState(initial);
  const [restrictions, setRestrictions] = useState(interactionRestrictions ?? []);
  const [tab, setTab] = useState("block");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const toast = useToast();
  const revalidator = useRevalidator();
  const all = userBlockState(settings) === "all";
  async function save() {
    const blockChanged = USER_BLOCK_OPTIONS.some(({ key }) => settings[key] !== baseline.settings[key]);
    const restrictionsChanged = interactionRestrictions !== null && (restrictions.length !== baseline.restrictions.length ||
      restrictions.some(kind => !baseline.restrictions.includes(kind)));
    if (!blockChanged && !restrictionsChanged) { onClose(); return; }
    setBusy(true);
    try {
      const response = await requestJson<{ ok: true; settings: UserBlockSettings }>(`/api/users/${peer.id}/block-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          ...(blockChanged ? settings : {}),
          ...(restrictionsChanged ? { interactionRestrictions: restrictions } : {}),
        }),
      });
      if (blockChanged) {
        notifyInboxChanged();
        onSaved(response.settings);
      }
      if (restrictionsChanged || settings.hidePosts !== baseline.settings.hidePosts) await revalidator.revalidate();
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  const blockOptions = <div className="grid gap-1">{USER_BLOCK_OPTIONS.map(option => <Label key={option.key} htmlFor={`${id}-${option.key}`} className="flex cursor-pointer items-center justify-between gap-4 rounded-md py-2">
    {option.label}<Checkbox id={`${id}-${option.key}`} checked={settings[option.key]} disabled={busy}
      onCheckedChange={value => setSettings(previous => ({ ...previous, [option.key]: value === true }))} />
  </Label>)}</div>;
  return <Dialog.Root open onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay />
      <Dialog.Content aria-describedby={undefined} className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5">
        <Dialog.Title>屏蔽设置</Dialog.Title>
        <div className="flex min-w-0 items-center gap-3"><UserAvatar avatarBlobSha256={peer.avatarBlobSha256} displayName={peer.displayName} size={32} /><span className="truncate font-semibold">{peer.displayName}</span></div>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (!busy) void save(); }}>
          {interactionRestrictions === null ? blockOptions : <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="屏蔽设置">
              <TabsTrigger value="block" disabled={busy}>屏蔽</TabsTrigger>
              <TabsTrigger value="restrict" disabled={busy}>拦截</TabsTrigger>
            </TabsList>
            <TabsContent value="block" className="pb-0 pt-2">{blockOptions}</TabsContent>
            <TabsContent value="restrict" className="pb-0 pt-2">
              <div className="grid gap-1">
                {INTERACTION_RESTRICTIONS.map(({ kind, label }) => <Label key={kind} htmlFor={`${id}-${kind}`} className="flex cursor-pointer items-center justify-between gap-4 rounded-md py-2">
                  {label}<Checkbox id={`${id}-${kind}`} checked={restrictions.includes(kind)} disabled={busy}
                    onCheckedChange={value => setRestrictions(previous => value === true ? [...previous, kind] : previous.filter(entry => entry !== kind))} />
                </Label>)}
              </div>
            </TabsContent>
          </Tabs>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tab === "block" || interactionRestrictions === null ? <Button type="button" variant="ghost" size="sm" className="mr-auto" disabled={busy}
              onClick={() => setSettings(Object.fromEntries(USER_BLOCK_OPTIONS.map(option => [option.key, !all])) as UserBlockSettings)}>{all ? "全部取消" : "全部屏蔽"}</Button> : null}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={busy}>保存</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
