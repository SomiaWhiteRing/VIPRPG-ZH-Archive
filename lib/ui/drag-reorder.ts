export type DragSlot = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function readDragSlots(elements: Iterable<Element>): DragSlot[] {
  return Array.from(elements, (child) => {
    const element = child as HTMLElement;
    return {
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  });
}

export function nearestDragSlot(slots: DragSlot[], x: number, y: number) {
  let nearest = -1;
  let distance = Infinity;
  slots.forEach((slot, index) => {
    const candidate =
      (x - slot.left - slot.width / 2) ** 2 +
      (y - slot.top - slot.height / 2) ** 2;
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  });
  return nearest;
}

export function moveDragItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from === to) return items;
  const order = [...items];
  order.splice(to, 0, order.splice(from, 1)[0]);
  return order;
}
