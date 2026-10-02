import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DragOverlay, type DropAnimation } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SortableHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">;

export function SortableListItem({ id, className, disabled = false, children }: {
  id: string;
  className: string;
  disabled?: boolean;
  children: (handle: SortableHandle) => ReactNode;
}) {
  const { setNodeRef, transform, transition, isDragging, ...handle } = useSortable({ id, disabled });
  return (
    <li ref={setNodeRef} className={className} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : undefined }}>
      {children(handle)}
    </li>
  );
}

export function SortableSnapshot({ element }: { element: HTMLElement }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const snapshot = element.cloneNode(true) as HTMLElement;
    snapshot.removeAttribute("id");
    snapshot.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    Object.assign(snapshot.style, { transform: "none", transition: "none", opacity: "1", width: "100%", listStyle: "none" });
    const target = container.current;
    target?.replaceChildren(snapshot);
    return () => target?.replaceChildren();
  }, [element]);
  return <div ref={container} aria-hidden inert className="pointer-events-none rounded-lg shadow-lg" />;
}

export function SortableOverlay({ children, dropAnimation = null }: { children: ReactNode; dropAnimation?: DropAnimation | null }) {
  // Keep the overlay mounted between drags; the source list may scroll independently.
  return typeof document === "undefined" ? null : createPortal(
    <DragOverlay dropAnimation={dropAnimation} zIndex={100} className="pointer-events-none select-none">
      {children}
    </DragOverlay>,
    document.body,
  );
}
