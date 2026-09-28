import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { emojiCellKey, type FaceEmoji } from "@/lib/face-emojis";

export const emojiDragId = (from: string, emoji: FaceEmoji) => `${from}:${emojiCellKey(emoji)}`;

export function EmojiDragSource({ emoji, disabled, children }: { emoji: FaceEmoji; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: emojiDragId("source", emoji), disabled, data: { emoji, from: "source" } });
  return <Slot.Root ref={setNodeRef} {...attributes} {...listeners} onContextMenu={(event) => event.preventDefault()}>{children}</Slot.Root>;
}

export function EmojiSortable({ emoji, disabled, children }: {
  emoji: FaceEmoji;
  disabled: boolean;
  children: (handle: Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">) => ReactNode;
}) {
  const { setNodeRef, transform, transition, isDragging, ...handle } = useSortable({ id: emojiDragId("library", emoji), disabled, data: { emoji, from: "library" } });
  return <div ref={setNodeRef} className="group relative size-14" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.25 : undefined }}>{children(handle)}</div>;
}

export function EmojiDropZone({ zone, ...props }: ComponentProps<"section"> & { zone: "source" | "library" }) {
  const { setNodeRef } = useDroppable({ id: zone, data: { zone } });
  return <section {...props} ref={setNodeRef} />;
}
