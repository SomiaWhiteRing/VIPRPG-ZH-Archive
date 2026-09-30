import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Smile } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import type { EmojiGroup } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";

export function EmojiPickerTabs({ groups, value, onSelect, disabled = false }: {
  groups: EmojiGroup[];
  value: number | null;
  onSelect: (id: number | null) => void;
  disabled?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const updateOverflow = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const left = node.scrollLeft > 1;
    const right = node.scrollWidth - node.clientWidth - node.scrollLeft > 1;
    setOverflow((current) => current.left === left && current.right === right ? current : { left, right });
  }, []);
  const reveal = useCallback((button: HTMLElement) => {
    const node = viewport.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    const bounds = node.getBoundingClientRect();
    const tab = button.getBoundingClientRect();
    const left = bounds.left + (node.scrollLeft > 1 ? 28 : 0);
    const right = bounds.right - (node.scrollWidth - node.clientWidth - node.scrollLeft > 1 ? 28 : 0);
    const distance = tab.left < left ? tab.left - left : tab.right > right ? tab.right - right : 0;
    if (distance) node.scrollBy({ left: distance, behavior: "instant" });
  }, []);
  const measure = useCallback(() => {
    const selected = track.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (selected) reveal(selected);
    updateOverflow();
  }, [reveal, updateOverflow]);
  useLayoutEffect(() => {
    const node = viewport.current, contents = track.current;
    if (!node || !contents) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(contents);
    return () => observer.disconnect();
  }, [measure]);
  useLayoutEffect(measure, [groups, value, measure]);

  function scroll(direction: number) {
    const node = viewport.current;
    if (!node) return;
    node.scrollBy({
      left: direction * Math.max(96, node.clientWidth * 0.75),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }
  return <div className="relative min-w-0 flex-1">
    <div ref={viewport} onScroll={updateOverflow} className="h-11 touch-pan-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={track} role="group" aria-label="表情分组" className="flex w-max items-center">
        {[{ id: null, name: "我的表情" }, ...groups].map((group) => <Button key={group.id ?? "all"} type="button" size="sm" variant="ghost"
          disabled={disabled} aria-pressed={value === group.id} title={group.id === null ? "我的表情（全部收藏）" : group.name}
          onClick={() => onSelect(group.id)} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) reveal(event.currentTarget); }}
          className={cn("h-11 max-w-40 rounded-none border-b-2 border-transparent px-2 text-xs font-normal text-muted hover:bg-transparent hover:text-primary focus-visible:ring-inset focus-visible:ring-offset-0 first:pl-0 sm:first:pl-2 [&_svg]:size-[18px]", value === group.id && "border-primary text-primary")}>
          {group.id === null ? <Smile aria-hidden /> : null}<span className="truncate">{group.name}</span>
        </Button>)}
      </div>
    </div>
    {overflow.left ? <div className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center bg-linear-to-r from-card via-card/90 to-transparent">
      <Button type="button" size="icon" variant="ghost" className="pointer-events-auto size-6 rounded-none" disabled={disabled}
        aria-label="向左滚动分组" title="向左滚动分组" onClick={() => scroll(-1)}><ChevronLeft aria-hidden /></Button>
    </div> : null}
    {overflow.right ? <div className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-linear-to-l from-card via-card/90 to-transparent">
      <Button type="button" size="icon" variant="ghost" className="pointer-events-auto size-6 rounded-none" disabled={disabled}
        aria-label="向右滚动分组" title="向右滚动分组" onClick={() => scroll(1)}><ChevronRight aria-hidden /></Button>
    </div> : null}
  </div>;
}
