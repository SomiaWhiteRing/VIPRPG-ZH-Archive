import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { ShowcaseKind } from "@/lib/showcase";

type Position = { top: number; height: number };
type Drag = {
  kind: ShowcaseKind;
  order: ShowcaseKind[];
  positions: Map<ShowcaseKind, Position>;
  gap: number;
  grabOffset: number;
  lastY: number;
};

function projectedPositions(drag: Drag) {
  let top = 0;
  return new Map(
    drag.order.map((kind) => {
      const height = drag.positions.get(kind)!.height;
      const position = { top, height };
      top += height + drag.gap;
      return [kind, position];
    }),
  );
}

export function useShowcaseReorder(
  order: ShowcaseKind[],
  disabled: boolean,
  onReorder: (order: ShowcaseKind[], kind: ShowcaseKind) => void,
) {
  const list = useRef<HTMLDivElement>(null);
  const current = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function end() {
    current.current = null;
    setDrag(null);
  }

  function start(kind: ShowcaseKind, event: DragEvent<HTMLButtonElement>) {
    if (
      disabled ||
      !list.current ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      event.preventDefault();
      return;
    }
    const rows = Array.from(list.current.children) as HTMLElement[];
    const row = rows[order.indexOf(kind)];
    const bounds = row.getBoundingClientRect();
    const positions = new Map(
      order.map((key, index) => [
        key,
        {
          top: rows[index].offsetTop - rows[0].offsetTop,
          height: rows[index].offsetHeight,
        },
      ]),
    );
    const value: Drag = {
      kind,
      order,
      positions,
      gap:
        rows.length > 1
          ? rows[1].offsetTop - rows[0].offsetTop - rows[0].offsetHeight
          : 0,
      grabOffset: event.clientY - bounds.top,
      lastY: event.clientY - list.current.getBoundingClientRect().top,
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-viprpg-showcase", kind);
    event.dataTransfer.setDragImage(
      row,
      event.clientX - bounds.left,
      value.grabOffset,
    );
    current.current = value;
    setDrag(value);
  }

  function over(event: DragEvent<HTMLDivElement>) {
    const value = current.current;
    if (!value || disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const direction = Math.sign(y - value.lastY);
    value.lastY = y;
    if (!direction) return;
    const index = value.order.indexOf(value.kind);
    // Cross the neighbouring row's midpoint; use direction to avoid oscillating between unequal rows.
    const edge =
      y -
      value.grabOffset +
      (direction > 0 ? value.positions.get(value.kind)!.height : 0);
    const nextOrder = [...value.order];
    let destination = index;
    while (
      destination + direction >= 0 &&
      destination + direction < nextOrder.length
    ) {
      const neighbour = projectedPositions({ ...value, order: nextOrder }).get(
        nextOrder[destination + direction],
      )!;
      const midpoint = neighbour.top + neighbour.height / 2;
      if (direction > 0 ? edge <= midpoint : edge >= midpoint) break;
      nextOrder.splice(
        destination + direction,
        0,
        nextOrder.splice(destination, 1)[0],
      );
      destination += direction;
    }
    if (destination === index) return;
    const next = { ...value, order: nextOrder };
    current.current = next;
    setDrag(next);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    const value = current.current;
    if (!value) return;
    event.preventDefault();
    if (!disabled) onReorder(value.order, value.kind);
    end();
  }

  function keyDown(
    kind: ShowcaseKind,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (disabled || current.current) return;
    const index = order.indexOf(kind);
    const destination =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? order.length - 1
          : event.key === "ArrowUp"
            ? index - 1
            : event.key === "ArrowDown"
              ? index + 1
              : null;
    if (destination === null) return;
    event.preventDefault();
    if (destination < 0 || destination >= order.length || destination === index)
      return;
    const next = [...order];
    next.splice(destination, 0, next.splice(index, 1)[0]);
    const handle = event.currentTarget;
    onReorder(next, kind);
    window.requestAnimationFrame(() => handle.focus());
  }

  const projected = drag ? projectedPositions(drag) : null;
  return {
    list,
    drag,
    start,
    end,
    over,
    drop,
    keyDown,
    offset: (kind: ShowcaseKind) =>
      drag && projected
        ? { x: 0, y: projected.get(kind)!.top - drag.positions.get(kind)!.top }
        : undefined,
  };
}
