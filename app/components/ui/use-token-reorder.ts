import {
  moveDragItem,
  nearestDragSlot,
  readDragSlots,
  type DragSlot,
} from "@/lib/ui/drag-reorder";
import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";

type Preview<T> = {
  original: T[];
  order: number[];
  index: number;
  element: HTMLElement;
  chip: { left: number; top: number; width: number; height: number };
};

export const tokenDragHandleClassName =
  "h-auto min-h-7 min-w-0 shrink touch-none select-none cursor-grab whitespace-normal rounded-none px-0 text-left text-xs font-semibold text-secondary hover:bg-transparent [overflow-wrap:anywhere] active:cursor-grabbing";

export function useTokenReorder<T>(
  values: T[],
  onChange: (values: T[]) => void,
  disabled = false,
) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<(Preview<T> & {
    slots: DragSlot[];
    x: number;
    y: number;
    moved: boolean;
  }) | null>(null);
  const suppressClick = useRef(false);
  const pendingFocus = useRef<number | null>(null);
  const [preview, setPreview] = useState<Preview<T> | null>(null);
  function matchesValues(original: T[]) {
    return original.length === values.length &&
      original.every((value, index) => value === values[index]);
  }
  const visiblePreview = !disabled && preview && matchesValues(preview.original) ? preview : null;

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const handles = container.current?.querySelectorAll<HTMLButtonElement>("[data-token-drag-handle]");
    handles?.[pendingFocus.current]?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [values]);

  function cancel() {
    drag.current = null;
    setPreview(null);
  }

  const containerProps: HTMLAttributes<HTMLDivElement> = {
    onPointerMove(event) {
      const current = drag.current;
      if (!current || disabled || !matchesValues(current.original)) return;
      if (
        !current.moved &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
      ) return;
      // Keep clicks on the handle; capture the container only once dragging starts.
      if (!current.moved) {
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = current.element.getBoundingClientRect();
        current.chip.width = bounds.width;
        current.chip.height = bounds.height;
      }
      current.moved = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      const nearest = nearestDragSlot(
        current.slots, event.clientX - bounds.left, event.clientY - bounds.top,
      );
      current.order = moveDragItem(current.order, current.order.indexOf(current.index), nearest);
      setPreview({
        ...current,
        chip: {
          ...current.chip,
          left: current.chip.left + event.clientX - current.x,
          top: current.chip.top + event.clientY - current.y,
        },
      });
    },
    onPointerUp() {
      const current = drag.current;
      cancel();
      if (!current?.moved) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      pendingFocus.current = null;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && container.current?.contains(activeElement)) {
        activeElement.blur();
      }
      if (!disabled && matchesValues(current.original)) {
        onChange(current.order.map((index) => values[index]));
      }
    },
    onPointerCancel: cancel,
    onLostPointerCapture(event) {
      if (event.target === event.currentTarget || !drag.current?.moved) cancel();
    },
    onClickCapture(event) {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    },
    onKeyDown(event) {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    },
  };

  function handleProps(index: number): HTMLAttributes<HTMLButtonElement> & {
    "data-token-drag-handle": string;
  } {
    return {
      "data-token-drag-handle": "",
      onPointerDown(event) {
        if (disabled || event.button !== 0 || !event.isPrimary || !container.current) return;
        const chip = event.currentTarget.closest<HTMLElement>("[data-sort-token]");
        if (!chip) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const bounds = chip.getBoundingClientRect();
        drag.current = {
          index,
          element: chip,
          original: values,
          order: values.map((_, itemIndex) => itemIndex),
          slots: readDragSlots(container.current.querySelectorAll("[data-sort-token]")),
          x: event.clientX,
          y: event.clientY,
          moved: false,
          chip: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        };
      },
      onKeyDown(event) {
        if (
          disabled || !event.altKey ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        ) return;
        event.preventDefault();
        event.stopPropagation();
        const to = index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
        if (to >= 0 && to < values.length) {
          pendingFocus.current = to;
          onChange(moveDragItem(values, index, to));
        }
      },
    };
  }

  return {
    container,
    containerProps,
    handleProps,
    preview: visiblePreview,
    items: (visiblePreview?.order ?? values.map((_, index) => index))
      .map((index) => ({ value: values[index], index })),
  };
}
