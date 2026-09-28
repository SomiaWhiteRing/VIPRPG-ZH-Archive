import { useEffect, useRef, useState, type HTMLAttributes } from "react";

type Preview = {
  key: string;
  width: number;
  height: number;
  left: number;
  top: number;
  before: string | null;
};

export function useShortcutTouchReorder(onMove: (key: string, before: string | null) => void) {
  const session = useRef<{
    pointerId: number;
    container: HTMLDivElement;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    timer: ReturnType<typeof setTimeout>;
    frame: number;
    preview: Preview | null;
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  function cancel() {
    const current = session.current;
    session.current = null;
    if (current) {
      clearTimeout(current.timer);
      cancelAnimationFrame(current.frame);
      if (current.container.hasPointerCapture(current.pointerId)) current.container.releasePointerCapture(current.pointerId);
    }
    setPreview(null);
  }

  useEffect(() => () => {
    const current = session.current;
    if (current) {
      clearTimeout(current.timer);
      cancelAnimationFrame(current.frame);
    }
  }, []);

  const props: HTMLAttributes<HTMLDivElement> = {
    onPointerDownCapture(event) {
      if (event.pointerType !== "touch" || !event.isPrimary || event.button !== 0 || session.current) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[slot="drag"]')) return;
      const row = target.closest<HTMLElement>("[data-shortcut-key]");
      if (!row) return;
      // Own touch dragging before the browser creates an Android system drag shadow.
      event.preventDefault();
      event.stopPropagation();
      const container = event.currentTarget;
      container.setPointerCapture(event.pointerId);
      const rect = row.getBoundingClientRect();
      const key = row.dataset.shortcutKey!;
      const current = {
        pointerId: event.pointerId, container, x: event.clientX, y: event.clientY,
        offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
        timer: setTimeout(() => {
          current.preview = { key, width: rect.width, height: rect.height, left: rect.left, top: rect.top, before: key };
          let previousTime = performance.now();
          const update = (time: number) => {
            if (session.current !== current || !current.preview) return;
            const elapsed = Math.min(time - previousTime, 32);
            previousTime = time;
            const edge = 80;
            const speed = current.y < edge ? -1 : current.y > window.innerHeight - edge ? 1 : 0;
            if (speed) window.scrollBy(0, speed * elapsed * 0.5);
            const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-shortcut-key]"));
            const before = rows.find((item) => {
              if (item.dataset.shortcutKey === key) return false;
              const bounds = item.getBoundingClientRect();
              return current.y < bounds.top + bounds.height / 2;
            })?.dataset.shortcutKey ?? null;
            const next = { ...current.preview, left: current.x - current.offsetX, top: current.y - current.offsetY, before };
            current.preview = next;
            setPreview((old) => old?.left === next.left && old.top === next.top && old.before === next.before ? old : next);
            current.frame = requestAnimationFrame(update);
          };
          current.frame = requestAnimationFrame(update);
        }, 250),
        frame: 0,
        preview: null as Preview | null,
      };
      session.current = current;
    },
    onPointerMoveCapture(event) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (!current.preview && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) {
        cancel();
        return;
      }
      current.x = event.clientX;
      current.y = event.clientY;
    },
    onPointerUpCapture(event) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const result = current.preview;
      cancel();
      if (result) onMove(result.key, result.before);
    },
    onPointerCancelCapture: cancel,
    onLostPointerCapture: cancel,
    onDragStartCapture(event) {
      if (session.current) event.preventDefault();
    },
    onContextMenuCapture(event) {
      if (session.current) event.preventDefault();
    },
    onKeyDownCapture(event) {
      if (event.key === "Escape" && session.current) cancel();
    },
  };
  return { props, preview };
}
