import { StackSortableItem, DragSlot, closestDragCenter, dragKeyboardCoordinates, type DragHandle } from "@/app/components/ui/multi-drag";
import { useDraggable, useDroppable, type CollisionDetection, type KeyboardCoordinateGetter, pointerWithin } from "@dnd-kit/core";
import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import type { CharacterRoleKey } from "@/lib/character-names";

export type CharacterDragSource =
  | { from: "library"; characterId: number }
  | { from: "work"; index: number };
export type CharacterDropTarget =
  | { kind: "remove" }
  | { kind: "role"; role: CharacterRoleKey }
  | { kind: "credit"; role: CharacterRoleKey; index: number };
export function CharacterLibraryDragItem({ id, source, disabled, lifted, settling, children, ...props }: Omit<ComponentProps<"div">, "id" | "children"> & {
  id: string; source: Extract<CharacterDragSource, { from: "library" }>; disabled: boolean; lifted: boolean; settling: boolean; children: (handle: DragHandle) => ReactNode;
}) {
  const { setNodeRef, attributes, listeners, setActivatorNodeRef, isDragging } = useDraggable({ id, data: source, disabled });
  const body = useMemo(() => children({ attributes, listeners, setActivatorNodeRef }), [children, attributes, listeners, setActivatorNodeRef]);
  return <div {...props} data-drag-id={id} ref={setNodeRef} style={{ opacity: settling ? 0 : lifted || isDragging ? 0.25 : undefined }}>{body}</div>;
}

export function CharacterDragSlot({ id, role, disabled }: { id: string; role: CharacterRoleKey; disabled: boolean }) {
  return <DragSlot id={id} data={{ kind: "role", role }} disabled={disabled} className="h-[38px] min-w-0" />;
}
export function CharacterDragItem({ source, target, ...props }: Omit<ComponentProps<typeof StackSortableItem>, "data" | "droppableDisabled"> & { source: CharacterDragSource; target?: CharacterDropTarget }) {
  return <StackSortableItem {...props} data={{ ...source, ...target }} droppableDisabled={!target} />;
}

export function CharacterDropZone({ id, target, disabled, ...props }: ComponentProps<"section"> & {
  id: string;
  target: CharacterDropTarget;
  disabled: boolean;
}) {
  const { setNodeRef } = useDroppable({ id, data: target, disabled });
  return <section {...props} ref={setNodeRef} />;
}

export const characterCollisionDetection: CollisionDetection = (args) => {
  const allowed = args.active.data.current?.from === "work" ? args.droppableContainers
    : args.droppableContainers.filter((item) => item.data.current?.kind !== "remove");
  if (!args.pointerCoordinates) return closestDragCenter({ ...args, droppableContainers: allowed });
  const hits = pointerWithin({ ...args, droppableContainers: allowed });
  const credits = hits.filter((hit) => hit.data?.droppableContainer.data.current?.kind === "credit");
  if (credits.length) return credits;
  const role = hits.find((hit) => hit.data?.droppableContainer.data.current?.kind === "role");
  const container = role?.data?.droppableContainer as typeof allowed[number] | undefined;
  const viewport = container?.node.current?.querySelector<HTMLElement>("[data-role-viewport]")?.getBoundingClientRect();
  if (viewport && args.pointerCoordinates.x >= viewport.left && args.pointerCoordinates.x <= viewport.right && args.pointerCoordinates.y >= viewport.top && args.pointerCoordinates.y <= viewport.bottom) {
    const rows = allowed.filter((item) => item.data.current?.role === container?.data.current?.role && (item.data.current?.kind === "credit" || item.id === args.active.id));
    if (rows.length) return closestDragCenter({ ...args, droppableContainers: rows });
  }
  return hits;
};

export const characterKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => dragKeyboardCoordinates(event, args, (item) =>
  item.data.current?.kind !== "remove" || args.context.active?.data.current?.from === "work",
);
