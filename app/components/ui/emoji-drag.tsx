import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Slot } from "radix-ui";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { StackSortableItem, DragSlot, type DragHandle } from "@/app/components/ui/multi-drag";
import { emojiCellKey, type FaceEmoji } from "@/lib/face-emojis";

export const emojiDragId = (from: string, emoji: FaceEmoji) => `${from}:${emojiCellKey(emoji)}`;

export function EmojiDragSource({ emoji, disabled, children, lifted = false, settling = false, onSelect }: {
  emoji: FaceEmoji; disabled: boolean; children: ReactNode; lifted?: boolean; settling?: boolean; onSelect?: (emoji: FaceEmoji, additive: boolean) => void;
}) {
  const id = emojiDragId("source", emoji);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled, data: { emoji, from: "source" } });
  return useMemo(() => <Slot.Root ref={setNodeRef} {...attributes} {...listeners} data-drag-id={id}
    style={{ opacity: settling ? 0 : lifted || isDragging ? 0.25 : undefined }} onContextMenu={(event) => event.preventDefault()}
    onClickCapture={(event) => { if (event.ctrlKey && onSelect) { event.preventDefault(); event.stopPropagation(); onSelect(emoji, true); } }}>{children}</Slot.Root>,
  [setNodeRef, attributes, listeners, id, settling, lifted, isDragging, onSelect, emoji, children]);
}

export function EmojiSortable({ emoji, disabled, packed, lifted, settling, children }: {
  emoji: FaceEmoji;
  disabled: boolean;
  packed?: boolean;
  lifted?: boolean;
  settling?: boolean;
  children: (handle: DragHandle) => ReactNode;
}) {
  return <StackSortableItem id={emojiDragId("library", emoji)} data={{ emoji, from: "library" }} disabled={disabled} packed={packed} lifted={lifted} settling={settling} className="group relative size-14">{children}</StackSortableItem>;
}

export function EmojiDragSlot({ id, disabled }: { id: string; disabled: boolean }) {
  return <DragSlot id={id} data={{ from: "library", slot: true }} disabled={disabled} className="size-14" />;
}

export function EmojiDropZone({ zone, ...props }: ComponentProps<"section"> & { zone: "source" | "library" }) {
  const { setNodeRef } = useDroppable({ id: zone, data: { zone } });
  return <section {...props} ref={setNodeRef} />;
}
