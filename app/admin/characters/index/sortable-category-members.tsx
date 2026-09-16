"use client";

import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Folder, GripVertical } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import type { CharacterBrowseNode } from "@/lib/character-index";
import { cn } from "@/lib/ui/cn";

export type MemberMove = { characterId: number; targetCharacterId: number; position: "before" | "after" };
type DragPreview = { id: string; characterId: number; nodes: CharacterBrowseNode[]; move: MemberMove | null };

export function SortableCategoryMembers({ nodes, busy, sortDisabled, onSelect, onReorder }: {
  nodes: CharacterBrowseNode[]; busy: boolean; sortDisabled: boolean;
  onSelect: (node: CharacterBrowseNode) => void;
  onReorder: (nodes: CharacterBrowseNode[], move: MemberMove) => void;
}) {
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const drag = useRef<DragPreview | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, DOMRect>());
  const visibleNodes = preview?.nodes ?? nodes;

  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const [id, element] of elements.current) {
        const previous = positions.current.get(id);
        if (!previous) continue;
        element.getAnimations().forEach((animation) => animation.cancel());
        const current = element.getBoundingClientRect();
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        if (x || y) element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 160, easing: "ease-out" });
      }
    }
    positions.current.clear();
  }, [preview]);

  function rememberPositions() {
    positions.current = new Map([...elements.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
  }
  function resetDrag() {
    if (!drag.current) return;
    rememberPositions();
    drag.current = null;
    setPreview(null);
  }
  function previewMove(event: DragEvent<HTMLDivElement>, node: CharacterBrowseNode) {
    const current = drag.current;
    if (!current || sortDisabled || node.kind !== "character" || current.id === node.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const from = current.nodes.findIndex((item) => item.id === current.id);
    const target = current.nodes.findIndex((item) => item.id === node.id);
    const element = event.currentTarget;
    // Hit-test the layout position, not the animated visual position.
    element.getAnimations().forEach((animation) => animation.cancel());
    const bounds = element.getBoundingClientRect();
    const afterMidpoint = event.clientX >= bounds.left + bounds.width / 2;
    if ((from < target && !afterMidpoint) || (from > target && afterMidpoint)) return;
    const reordered = [...current.nodes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(target, 0, moved);
    const next: DragPreview = { ...current, nodes: reordered, move: {
      characterId: current.characterId, targetCharacterId: node.character.id, position: from < target ? "after" : "before",
    } };
    rememberPositions();
    drag.current = next;
    setPreview(next);
  }

  return <div className="flex flex-wrap gap-2" onDragOver={(event) => {
    if (drag.current && !sortDisabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  }} onDrop={(event) => {
    const current = drag.current;
    if (!current) return;
    event.preventDefault();
    drag.current = null;
    setPreview(null);
    if (!sortDisabled && current.move && current.nodes.some((node, index) => node.id !== nodes[index]?.id)) onReorder(current.nodes, current.move);
  }}>
    {visibleNodes.map((node) => {
      const movable = node.kind === "character" && !sortDisabled;
      const moving = preview?.id === node.id;
      return <div key={node.id} ref={(element) => { if (element) elements.current.set(node.id, element); else elements.current.delete(node.id); }}
        draggable={movable} onDragStart={(event) => {
          if (!movable || node.kind !== "character") { event.preventDefault(); return; }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          const next = { id: node.id, characterId: node.character.id, nodes, move: null };
          drag.current = next;
          setPreview(next);
        }} onDragOver={(event) => previewMove(event, node)} onDragEnd={resetDrag}>
        <Button type="button" variant="outline" size="sm" disabled={busy}
          className={cn(movable && "cursor-grab active:cursor-grabbing", moving && "border-dashed border-primary bg-primary/10 opacity-40")}
          title={movable ? `拖动排序：${node.label}` : undefined}
          onClick={() => { if (!drag.current) onSelect(node); }}>
          {node.kind === "character" ? <GripVertical aria-hidden size={13} /> : <Folder aria-hidden size={13} />}{node.label}
        </Button>
      </div>;
    })}
  </div>;
}
