import { useMessages } from "@/lib/i18n/react";
import { useEffect, useId, useRef, useState } from "react";
import { Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { DndContext, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SortableListItem, SortableOverlay, SortableSnapshot } from "@/app/components/ui/sortable-list-item";
import { useToast } from "@/app/components/ui/toast";
import type { EmojiGroup, EmojiLibraryData } from "@/lib/face-emojis";
import { emojiRequest } from "./client";
import { EmojiGroupDialog } from "./group-dialog";

function GroupName({ group, disabled, onSave }: { group: EmojiGroup; disabled: boolean; onSave: (name: string) => void }) {
  const t = useMessages();
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);
  const changed = name.trim().normalize("NFC") !== group.name;
  return <><Input className="min-w-0 flex-1" value={name} maxLength={20} disabled={disabled} aria-label={t("emoji.group.name", { name: group.name })} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (changed && !disabled) onSave(name); } }} />
    <Button type="button" size="icon" variant="ghost" className={changed ? undefined : "invisible"} disabled={disabled || !changed} aria-label={t("emoji.group.saveName", { name: group.name })} onClick={() => onSave(name)}><Check aria-hidden /></Button></>;
}
export function EmojiGroupManager({ open, onOpenChange, groups, onChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: EmojiGroup[];
  onChange: (data: EmojiLibraryData) => void;
  onCreated: (id: number) => void;
}) {
  const t = useMessages();
  const [items, setItems] = useState(groups);
  const [pending, setPending] = useState(false);
  const [activeNode, setActiveNode] = useState<HTMLElement | null>(null);
  const lock = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const toast = useToast();
  const dndId = useId();
  useEffect(() => setItems(groups), [groups]);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  async function mutate(body: object, rollback?: EmojiGroup[]) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const data = await emojiRequest<EmojiLibraryData & { createdGroupId?: number }>("/api/emojis", body);
      setItems(data.groups);
      onChange(data);
      if (data.createdGroupId !== undefined) onCreated(data.createdGroupId);
    } catch (error) {
      if (rollback) setItems(rollback);
      toast.error(error instanceof Error ? error.message : t("emoji.group.failed"));
    } finally { lock.current = false; setPending(false); }
  }
  return <EmojiGroupDialog open={open} onOpenChange={onOpenChange} busy={pending} title={t("emoji.group.manage")}>
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: t("emoji.group.instructions") }, announcements: { onDragStart: () => t("emoji.group.picked"), onDragOver: () => t("emoji.group.moving"), onDragEnd: () => t("emoji.group.dropped"), onDragCancel: () => t("emoji.group.canceled") } }}
      onDragStart={({ active }) => setActiveNode(list.current?.querySelector<HTMLElement>(`[data-emoji-group="${active.id}"]`)?.closest("li") ?? null)}
      onDragCancel={() => setActiveNode(null)} onDragEnd={({ active, over }) => {
        setActiveNode(null);
        if (lock.current || !over || active.id === over.id) return;
        const from = items.findIndex((group) => group.id === Number(active.id)), to = items.findIndex((group) => group.id === Number(over.id));
        if (from < 0 || to < 0) return;
        const next = arrayMove(items, from, to), index = next.findIndex((group) => group.id === Number(active.id));
        setItems(next);
        void mutate({ op: "group.reorder", id: Number(active.id), beforeId: next[index + 1]?.id ?? null }, items);
      }}>
      <SortableContext items={items.map((group) => String(group.id))} strategy={verticalListSortingStrategy}>
        <ul ref={list} className="m-0 grid list-none gap-2 p-0">{items.map((group) => <SortableListItem key={group.id} id={String(group.id)} disabled={pending} className="min-w-0 border-b border-border py-1">
          {({ attributes, listeners, setActivatorNodeRef }) => <div data-emoji-group={group.id} className="flex min-w-0 items-center gap-1">
            <Button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" size="icon" variant="ghost" disabled={pending} aria-label={t("emoji.group.drag", { name: group.name })} className="touch-none cursor-grab active:cursor-grabbing"><GripVertical aria-hidden /></Button>
            <GroupName group={group} disabled={pending} onSave={(name) => void mutate({ op: "group.rename", id: group.id, name })} />
            <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label={t("emoji.group.delete", { name: group.name })} onClick={() => void mutate({ op: "group.delete", id: group.id })}><Trash2 aria-hidden /></Button>
          </div>}
        </SortableListItem>)}</ul>
      </SortableContext>
      <SortableOverlay>{activeNode ? <SortableSnapshot element={activeNode} /> : null}</SortableOverlay>
    </DndContext>
    {!items.length ? <p className="m-0 text-sm text-muted">{t("emoji.group.empty")}</p> : null}
    <div className="flex items-center justify-between gap-2"><span role="status" className="text-xs text-muted">{pending ? t("admin.discussionTags.saving") : ""}</span><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void mutate({ op: "group.create" })}><Plus aria-hidden />{t("emoji.group.create")}</Button></div>
  </EmojiGroupDialog>;
}
