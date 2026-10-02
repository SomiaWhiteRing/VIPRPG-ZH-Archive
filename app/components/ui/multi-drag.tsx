import { getClientRect, useDndContext, useDroppable, type CollisionDetection, type KeyboardCoordinateGetter, type UniqueIdentifier } from "@dnd-kit/core";
import { defaultAnimateLayoutChanges, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentProps, type CSSProperties, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";

type DragContainer = Parameters<CollisionDetection>[0]["droppableContainers"][number];
const positions = new WeakMap<UniqueIdentifier[], Map<UniqueIdentifier, number>>();
function movedIndex(index: number, from: number, to: number) {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}
export const dragNewIndex: NonNullable<Parameters<typeof useSortable>[0]["getNewIndex"]> = ({ id, items, activeIndex, overIndex }) => {
  let lookup = positions.get(items);
  if (!lookup) { lookup = new Map(items.map((item, index) => [item, index])); positions.set(items, lookup); }
  return movedIndex(lookup.get(id) ?? -1, activeIndex, overIndex);
};
// Equivalent to rectSortingStrategy without copying the whole rect array per card.
export const dragSortingStrategy: SortingStrategy = ({ rects, activeIndex, overIndex, index }) => {
  const before = rects[index], after = rects[movedIndex(index, activeIndex, overIndex)];
  return before && after ? { x: after.left - before.left, y: after.top - before.top, scaleX: after.width / before.width, scaleY: after.height / before.height } : null;
};
export type DragHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef">;
export function StackSortableItem({ id, data, disabled, droppableDisabled = false, packed = false, lifted = false, settling = false, activateFromContainer = false, className, children, onMouseDown, onKeyDown, style, ...props }: Omit<ComponentProps<"div">, "id" | "children"> & {
  id: string; data: Record<string, unknown>; disabled: boolean; droppableDisabled?: boolean; packed?: boolean; lifted?: boolean; settling?: boolean; activateFromContainer?: boolean; children: ReactNode | ((handle: DragHandle) => ReactNode);
}) {
  const { setNodeRef: setSortableNode, transform, transition, isDragging, isSorting, ...handle } = useSortable({
    id, data, disabled: { draggable: disabled, droppable: disabled || droppableDisabled || packed }, getNewIndex: dragNewIndex,
    transition: { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    animateLayoutChanges: (args) => !packed && !settling && (args.isSorting || defaultAnimateLayoutChanges(args)),
  });
  const { attributes, listeners, setActivatorNodeRef } = handle;
  const body = useMemo(() => typeof children === "function" ? children({ attributes, listeners, setActivatorNodeRef }) : children, [children, attributes, listeners, setActivatorNodeRef]);
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setSortableNode(node); if (activateFromContainer) setActivatorNodeRef(node);
  }, [activateFromContainer, setActivatorNodeRef, setSortableNode]);
  return <div {...(activateFromContainer ? attributes : {})} {...props} data-drag-id={id} ref={setNodeRef} className={cn("min-w-0 motion-reduce:transition-none!", className, packed && "hidden", (isSorting || settling) && "pointer-events-none")}
    style={{ ...style, transform: !isDragging && !settling ? CSS.Transform.toString(transform) : undefined, transition: !settling ? transition : undefined, opacity: settling || lifted || isDragging ? 0 : undefined }}
    onMouseDown={(event) => {
      onMouseDown?.(event);
      if (activateFromContainer && event.button === 0 && !event.defaultPrevented && !(event.target as Element).closest("input, textarea, [data-drag-no-activate]")) listeners?.onMouseDown?.(event);
    }}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (activateFromContainer && !event.defaultPrevented && event.target === event.currentTarget) listeners?.onKeyDown?.(event);
    }}>{body}</div>;
}
export function DragSlot({ id, data, disabled, className }: { id: string; data: Record<string, unknown>; disabled: boolean; className: string }) {
  const { setNodeRef } = useDroppable({ id, data, disabled });
  return <div aria-hidden className={cn("pointer-events-none", className)} ref={setNodeRef} />;
}
export const closestDragCenter: CollisionDetection = ({ collisionRect, droppableContainers, droppableRects }) => {
  const x = collisionRect.left + collisionRect.width / 2, y = collisionRect.top + collisionRect.height / 2;
  let closest: DragContainer | undefined, distance = Infinity;
  for (const item of droppableContainers) {
    const rect = droppableRects.get(item.id); if (!rect) continue;
    const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
    const next = dx * dx + dy * dy;
    if (next < distance) { closest = item; distance = next; }
  }
  return closest ? [{ id: closest.id, data: { droppableContainer: closest, value: Math.sqrt(distance) } }] : [];
};
export function dragKeyboardCoordinates(event: Parameters<KeyboardCoordinateGetter>[0], { context }: Parameters<KeyboardCoordinateGetter>[1], accept: (item: DragContainer) => boolean) {
  const { collisionRect, droppableContainers, droppableRects } = context;
  if (!collisionRect || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) return;
  event.preventDefault();
  const x = collisionRect.left + collisionRect.width / 2, y = collisionRect.top + collisionRect.height / 2;
  let closest = collisionRect, distance = Infinity;
  for (const item of droppableContainers.getEnabled()) {
    if (!accept(item)) continue;
    const rect = droppableRects.get(item.id); if (!rect) continue;
    const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
    const ahead = event.code === "ArrowLeft" ? dx < -1 : event.code === "ArrowRight" ? dx > 1 : event.code === "ArrowUp" ? dy < -1 : dy > 1;
    const next = dx * dx + dy * dy;
    if (ahead && next < distance) { closest = rect; distance = next; }
  }
  return distance < Infinity ? { x: closest.left + (closest.width - collisionRect.width) / 2, y: closest.top + (closest.height - collisionRect.height) / 2 } : undefined;
}

export function useDragOrigin() {
  const origin = useRef<{ id: string; rect: DOMRect } | null>(null);
  const measure = useCallback((element: HTMLElement) => {
    const captured = origin.current;
    return captured && captured.id === element.dataset.dragId ? captured.rect : getClientRect(element, { ignoreTransform: true });
  }, []);
  const measuring = useMemo(() => ({ draggable: { measure } }), [measure]);
  return { origin, measuring };
}
export function DragSession({ dragging, onReset }: { dragging: boolean; onReset: () => void }) {
  const { active } = useDndContext();
  useLayoutEffect(() => {
    // A very fast start/release can omit dnd-kit's end callback.
    if (dragging && !active) onReset();
  }, [active, dragging, onReset]);
  return null;
}

export type DragPreviewItem = { id: string; content: ReactNode; x: number; y: number; width?: number; height?: number; held?: { transform: string; opacity: string } };
export type DragPreview = { items: DragPreviewItem[]; count: number };
type DragSnapshot = DragPreview & { rect: { left: number; top: number; width: number; height: number } };
export type DragLandingState = { snapshot: DragSnapshot; targets: Map<string, { id: string; fallback?: string }> };
export function captureDragPreview(container: HTMLElement | null, activeId: string, ids: string[], render: (id: string) => ReactNode) {
  const selected = new Set(ids), frames = new Map<HTMLElement, DOMRect>();
  const elements = new Map<string, { rect: DOMRect; visible: boolean }>();
  for (const node of container?.querySelectorAll<HTMLElement>("[data-drag-id]") ?? []) {
    const id = node.dataset.dragId!; if (!selected.has(id)) continue;
    const viewport = node.closest<HTMLElement>("[data-drag-viewport]");
    let frame = viewport && frames.get(viewport);
    if (viewport && !frame) { frame = viewport.getBoundingClientRect(); frames.set(viewport, frame); }
    const rect = node.getBoundingClientRect();
    elements.set(id, { rect, visible: Boolean(frame && rect.bottom > frame.top && rect.top < frame.bottom && rect.right > frame.left && rect.left < frame.right) });
  }
  const rect = elements.get(activeId)?.rect;
  const previews = [...new Set([activeId, ...[...elements].filter(([, item]) => item.visible).map(([id]) => id), ...ids.slice(0, 4)])].slice(0, 48);
  const items = previews.map((id): DragPreviewItem => {
    const item = elements.get(id), visible = rect && item?.visible;
    return { id, content: render(id), x: visible ? item.rect.left - rect.left : 0, y: visible ? item.rect.top - rect.top : 0, width: item?.rect.width, height: item?.rect.height };
  });
  return { preview: { items, count: ids.length }, origin: rect ? { id: activeId, rect } : null };
}
export function captureDragStack(element: HTMLDivElement | null, preview: DragPreview | null): DragSnapshot | null {
  if (!element || !preview) return null;
  const { left, top, width, height } = element.getBoundingClientRect();
  if (!width || !height) return null;
  const layers = new Map([...element.querySelectorAll<HTMLElement>("[data-drag-layer]")].map((node) => [node.dataset.dragLayer, node]));
  return { ...preview, rect: { left, top, width, height }, items: preview.items.map((item) => {
    const node = layers.get(item.id), style = node && getComputedStyle(node);
    return { ...item, held: { transform: style?.transform ?? "none", opacity: style?.opacity ?? "0" } };
  }) };
}
export function DragStack({ items, count, className, itemClassName, elementRef }: DragPreview & { className: string; itemClassName: string; elementRef?: Ref<HTMLDivElement> }) {
  const element = useRef<HTMLDivElement>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    if (typeof elementRef === "function") elementRef(node); else if (elementRef) elementRef.current = node;
  }, [elementRef]);
  useLayoutEffect(() => {
    const root = element.current; if (!root) return;
    const { width, height } = root.getBoundingClientRect(); if (!width || !height) return;
    const layers = new Map([...root.querySelectorAll<HTMLElement>("[data-drag-layer]")].map((node) => [node.dataset.dragLayer, node]));
    for (const item of items) {
      if (item.held) continue;
      const node = layers.get(item.id); if (!node) continue;
      const w = item.width || width, h = item.height || height;
      node.style.setProperty("--drag-pickup-x", `${item.x + (w - width) / 2}px`);
      node.style.setProperty("--drag-pickup-y", `${item.y + (h - height) / 2}px`);
      node.style.setProperty("--drag-pickup-scale-x", String(w / width));
      node.style.setProperty("--drag-pickup-scale-y", String(h / height));
    }
  }, [items]);
  return <div aria-hidden inert ref={setRef} className={cn("pointer-events-none relative", className)}>
    {items.map((item, index) => {
      const depth = Math.min(index, 3), x = index ? (index % 2 ? -1 : 1) * depth * 3 : 0, y = depth * 4, angle = index ? (index % 2 ? -1 : 1) * depth * 2 : 0;
      return <div key={item.id} data-drag-layer={item.id} className={cn("absolute inset-0 rounded border border-primary/50 bg-card shadow-lg motion-reduce:animate-none", itemClassName, !item.held && "animate-drag-stack-pickup")}
        style={{ zIndex: items.length - index, transform: `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(1.04)`, opacity: index < 4 ? 1 : 0,
          "--drag-pickup-x": `${item.x}px`, "--drag-pickup-y": `${item.y}px`, "--drag-stack-x": `${x}px`, "--drag-stack-y": `${y}px`, "--drag-stack-angle": `${angle}deg`, "--drag-stack-opacity": index < 4 ? 1 : 0, ...item.held,
        } as CSSProperties}>{item.content}</div>;
    })}
    {count > 1 ? <span data-drag-count className="absolute -right-2 -top-2 rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground shadow-sm" style={{ zIndex: items.length + 1 }}>{count}</span> : null}
  </div>;
}
export function DragLanding({ landing, container, onFinish, pending = false, itemClassName }: { landing: DragLandingState; container: RefObject<HTMLDivElement | null>; onFinish: () => void; pending?: boolean; itemClassName: string }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (pending) return;
    let cancelled = false;
    const animations: Animation[] = [];
    const frame = requestAnimationFrame(() => {
      const nodes = new Map([...container.current?.querySelectorAll<HTMLElement>("[data-drag-id]") ?? []].map((node) => [node.dataset.dragId, node]));
      const fallbacks = new Map([...container.current?.querySelectorAll<HTMLElement>("[data-drag-fallback]") ?? []].map((node) => [node.dataset.dragFallback, node]));
      const frames = new Map<HTMLElement, DOMRect>();
      const { rect } = landing.snapshot;
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
      for (const layer of element.current?.querySelectorAll<HTMLElement>("[data-drag-layer]") ?? []) {
        const target = landing.targets.get(layer.dataset.dragLayer!), node = target && nodes.get(target.id);
        const viewport = node?.closest<HTMLElement>("[data-drag-viewport]");
        let clip = viewport && frames.get(viewport);
        if (viewport && !clip) { clip = viewport.getBoundingClientRect(); frames.set(viewport, clip); }
        const bounds = node?.getBoundingClientRect();
        let left = rect.left, top = rect.top, width = rect.width * 0.8, height = rect.height * 0.8, opacity = 0;
        if (bounds?.width && bounds.height) {
          ({ left, top, width, height } = bounds);
          opacity = !clip || bounds.bottom > clip.top && bounds.top < clip.bottom && bounds.right > clip.left && bounds.left < clip.right ? 1 : 0;
          if (clip && !opacity) { top = Math.max(clip.top, Math.min(top, clip.bottom - height)); left = Math.max(clip.left, Math.min(left, clip.right - width)); }
        } else if (target?.fallback) {
          const fallback = fallbacks.get(target.fallback)?.getBoundingClientRect();
          if (fallback) { left = fallback.left + (fallback.width - width) / 2; top = fallback.top + (fallback.height - height) / 2; }
        }
        const x = left - rect.left + (width - rect.width) / 2, y = top - rect.top + (height - rect.height) / 2;
        animations.push(layer.animate([{ transform: layer.style.transform, opacity: layer.style.opacity }, { transform: `translate3d(${x}px, ${y}px, 0) scale(${width / rect.width}, ${height / rect.height})`, opacity }], { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }));
      }
      const badge = element.current?.querySelector<HTMLElement>("[data-drag-count]");
      if (badge) animations.push(badge.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: "forwards" }));
      void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => { if (!cancelled) onFinish(); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); animations.forEach((animation) => animation.cancel()); };
  }, [container, landing, onFinish, pending]);
  return createPortal(<div aria-hidden inert className="pointer-events-none fixed z-[100] select-none" style={landing.snapshot.rect}>
    <DragStack {...landing.snapshot} className="h-full w-full" itemClassName={itemClassName} elementRef={element} />
  </div>, document.body);
}
