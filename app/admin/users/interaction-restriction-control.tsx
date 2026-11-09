import { useId, useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import { useToast } from "@/app/components/ui/toast";
import { INTERACTION_RESTRICTIONS, type RestrictedInteraction } from "@/lib/interaction-restrictions";
import { requestJson } from "@/lib/ui/api-response";

export function InteractionRestrictionControl({ userId, displayName, kinds, disabled }: {
  userId: number;
  displayName: string;
  kinds: RestrictedInteraction[];
  disabled: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<RestrictedInteraction[] | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const revalidator = useRevalidator();

  async function save(next: RestrictedInteraction[]) {
    setSaving(true);
    try {
      await requestJson(`/api/admin/users/${userId}/interaction-restrictions`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kinds: next }),
      });
      await revalidator.revalidate();
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog.Root open={draft !== null} onOpenChange={open => {
    if (!saving) setDraft(open ? kinds : null);
  }}>
    <Dialog.Trigger asChild>
      <Button type="button" size="sm" variant="ghost" disabled={disabled}>限制对我的互动{kinds.length ? `（${kinds.length}）` : null}</Button>
    </Dialog.Trigger>
    {draft && <Dialog.Portal>
      <Dialog.Overlay />
      <Dialog.Content aria-describedby={undefined} className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5">
        <Dialog.Title>限制对我的互动</Dialog.Title>
        <p className="m-0 wrap-anywhere font-semibold">{displayName} <span className="font-mono text-xs text-muted">#{userId}</span></p>
        <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (!saving) void save(draft); }}>
          <div className="grid gap-1">
            {INTERACTION_RESTRICTIONS.map(({ kind, label }) => <Label key={kind} htmlFor={`${id}-${kind}`} className="flex cursor-pointer items-center justify-between gap-4 rounded-md py-2">
              {label}<Checkbox id={`${id}-${kind}`} checked={draft.includes(kind)} disabled={saving}
                onCheckedChange={value => setDraft(value === true ? [...draft, kind] : draft.filter(entry => entry !== kind))} />
            </Label>)}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={saving}>取消</Button></Dialog.Close>
            <Button type="submit" disabled={saving}>保存</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>}
  </Dialog.Root>;
}
