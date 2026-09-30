import { useId, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { FaceEmojiImage } from "@/app/components/ui/face-emoji-image";
import { Label } from "@/app/components/ui/label";
import type { EmojiGroup, EmojiGroupMembershipEdit, FaceEmoji } from "@/lib/face-emojis";
import { EmojiGroupDialog } from "./group-dialog";

type CheckedState = boolean | "indeterminate";
type GroupRow = EmojiGroup & { initial: CheckedState; checked: CheckedState };

export function EmojiGroupEditor({ onOpenChange, groups, emojis, onConfirm }: {
  onOpenChange: (open: boolean) => void;
  groups: EmojiGroup[];
  emojis: FaceEmoji[];
  onConfirm: (edit: EmojiGroupMembershipEdit) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<GroupRow[]>(() => groups.map((group) => {
    const count = emojis.filter((emoji) => emoji.groupIds?.includes(group.id)).length;
    const checked: CheckedState = count === 0 ? false : count === emojis.length ? true : "indeterminate";
    return { ...group, initial: checked, checked };
  }));
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const id = useId();
  const changed = rows.some((row) => row.checked !== row.initial);

  async function confirm() {
    if (!changed || !emojis.length || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const saved = await onConfirm({
        includeGroupIds: rows.filter((row) => row.checked === true).map((row) => row.id),
        excludeGroupIds: rows.filter((row) => row.checked === false).map((row) => row.id),
      });
      if (saved) onOpenChange(false);
    } finally { lock.current = false; setPending(false); }
  }
  return <EmojiGroupDialog open onOpenChange={onOpenChange} busy={pending} title="编辑分组">
    <div className="flex items-center gap-3"><FaceEmojiImage emoji={emojis[0] ?? null} size={72} /><span className="text-xs text-muted">{emojis.length > 1 ? `已选 ${emojis.length} 个表情` : emojis[0]?.sources.map((item) => item.name).join("、")}</span></div>
    <div className="grid gap-1" role="group" aria-label="表情分组归属">
      {rows.map((row) => <Label key={row.id} htmlFor={`${id}-${row.id}`} className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm font-normal hover:bg-muted/10">
        <span className="min-w-0 truncate" title={row.name}>{row.name}</span>
        <Checkbox id={`${id}-${row.id}`} checked={row.checked} disabled={pending} onCheckedChange={() => {
          // The first click on a mixed selection clears it.
          setRows((current) => current.map((item) => item.id === row.id ? { ...item, checked: item.checked === false } : item));
        }} />
      </Label>)}
      {!rows.length ? <p className="m-0 text-sm text-muted">还没有自建表情组</p> : null}
    </div>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button>
      <Button type="button" disabled={pending || !changed || !emojis.length} onClick={() => void confirm()}>{pending ? "正在保存…" : "确认"}</Button>
    </div>
  </EmojiGroupDialog>;
}
