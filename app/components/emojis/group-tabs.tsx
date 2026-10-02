import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useMemo, type Ref } from "react";
import { Button } from "@/app/components/ui/button";
import type { EmojiGroup, FaceEmoji } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";

export const emojiGroupDropId = (id: number | null) => `emoji-group:${id ?? "all"}`;
type TabProps = {
  id: number | null;
  name: string;
  count: number;
  active: boolean;
  disabled: boolean;
  canAdd: boolean;
  onSelect: (id: number | null) => void;
};
function GroupTab({ id, name, count, active, disabled, canAdd, onSelect, buttonRef, over = false }: TabProps & { buttonRef?: Ref<HTMLButtonElement>; over?: boolean }) {
  const highlight = over && canAdd && !disabled && !active;
  return <Button ref={buttonRef} type="button" size="sm" variant="ghost" disabled={disabled} data-drag-fallback={emojiGroupDropId(id)}
    aria-pressed={active} title={name} onClick={() => onSelect(id)}
    className={cn("h-8 max-w-40 gap-1 border border-transparent px-2 text-xs font-normal", active && "border-primary bg-primary/5 text-primary", highlight && "ring-2 ring-primary")}>
    <span className="truncate">{name}</span><span className="tabular-nums text-muted">{count}</span>
  </Button>;
}
function DroppableGroupTab(props: TabProps) {
  const { setNodeRef, isOver } = useDroppable({ id: emojiGroupDropId(props.id), disabled: props.disabled, data: { groupId: props.id } });
  return <GroupTab {...props} buttonRef={setNodeRef} over={isOver} />;
}
export function EmojiGroupTabs({ groups, emojis, value, onSelect, onCreate, canAdd, disabled = false, droppable = false, management = false }: {
  groups: EmojiGroup[];
  emojis: FaceEmoji[];
  value: number | null;
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  canAdd?: (id: number | null) => boolean;
  disabled?: boolean;
  droppable?: boolean;
  management?: boolean;
}) {
  const counts = useMemo(() => {
    const result = new Map<number | null, number>([[null, emojis.length]]);
    for (const emoji of emojis) for (const id of new Set(emoji.groupIds ?? [])) result.set(id, (result.get(id) ?? 0) + 1);
    return result;
  }, [emojis]);
  if (!management && !groups.length) return null;
  const Tab = droppable ? DroppableGroupTab : GroupTab;
  return <div className="flex shrink-0 items-start gap-1 border-b border-border p-2">
    <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="表情分组">
      {[{ id: null, name: "全部" }, ...groups].map((group) => <Tab key={group.id ?? "all"} id={group.id} name={group.name}
        count={counts.get(group.id) ?? 0}
        active={value === group.id} disabled={disabled} canAdd={canAdd?.(group.id) ?? false} onSelect={onSelect} />)}
    </div>
    <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" disabled={disabled} onClick={onCreate} aria-label="新建表情分组" title="新建表情分组"><Plus aria-hidden /></Button>
  </div>;
}
