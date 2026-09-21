import { Button } from "@/app/components/ui/button";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Settings2 } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { controlDefinitions, controlIds, defaultControlLayouts } from "./web-play-controls-preferences";
import type { ControlId, ControlLayout, ControlPlacement, DisplayOrientation } from "./web-play-controls-preferences";
import { WebPlayLayoutEditor } from "./web-play-layout-editor";
import type { PlayerButton, PlayerSession } from "./web-play-player";

type Props = {
  mobile: boolean;
  immersive: boolean;
  orientation: DisplayOrientation;
  rotation: number;
  layout: ControlLayout;
  onSaveLayout: (orientation: DisplayOrientation, layout: ControlLayout) => void;
  playerRef: RefObject<PlayerSession | null>;
  playerHostRef: RefObject<HTMLDivElement | null>;
  toolbar: ReactNode;
  placeholder: ReactNode;
  feedback: ReactNode;
};

const overlayButtonClass = "border-white/35 bg-black/65 text-white hover:border-white hover:bg-black/80 hover:text-white";
const controlButtonClass = "h-full min-h-0 w-full touch-none select-none rounded-full border-2 border-white/80 bg-zinc-800 p-0 text-white hover:bg-zinc-600 hover:text-white data-[pressed=true]:border-white data-[pressed=true]:bg-zinc-500 [&_svg]:size-[45%]";
const directions = [
  { key: "up", label: "上", Icon: ArrowUp, className: "col-start-2 row-start-1" },
  { key: "left", label: "左", Icon: ArrowLeft, className: "col-start-1 row-start-2" },
  { key: "right", label: "右", Icon: ArrowRight, className: "col-start-3 row-start-2" },
  { key: "down", label: "下", Icon: ArrowDown, className: "col-start-2 row-start-3" },
] as const;
const buttonKeys: PlayerButton[] = ["up", "left", "right", "down", "decision", "cancel", "shift", "menu", "debug", "log"];
const clampPosition = (value: number) => Math.max(0, Math.min(1, value));
type Point = { x: number; y: number };
type DragTarget = ControlId | "screen";

export function WebPlaySurface({
  mobile, immersive, orientation, rotation, layout, onSaveLayout,
  playerRef, playerHostRef, toolbar, placeholder, feedback,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ControlLayout | null>(null);
  const [selected, setSelected] = useState<ControlId>("decision");
  const [dragging, setDragging] = useState(false);
  const [held, setHeld] = useState<Set<PlayerButton>>(new Set());
  const heldRef = useRef(new Set<PlayerButton>());
  const pointersRef = useRef(new Map<number, { buttons: PlayerButton[]; element: HTMLElement }>());
  const travelRef = useRef<Partial<Record<DragTarget, Point>>>({});
  const dragRef = useRef<{
    pointerId: number; target: DragTarget; element: HTMLElement;
    start: Point; position: Point; travel: Point;
  } | null>(null);
  const portrait = orientation === "portrait";
  const editing = mobile && draft !== null;
  const positions = editing ? draft : layout;

  const updatePointer = useCallback((id: number, buttons: PlayerButton[], element: HTMLElement, active = buttons.length > 0) => {
    if (active) pointersRef.current.set(id, { buttons, element });
    else pointersRef.current.delete(id);
    const next = new Set([...pointersRef.current.values()].flatMap((pointer) => pointer.buttons));
    for (const key of heldRef.current) {
      if (!next.has(key)) playerRef.current?.setButtonPressed(key, false);
    }
    for (const key of next) {
      if (!heldRef.current.has(key)) playerRef.current?.setButtonPressed(key, true);
    }
    heldRef.current = next;
    setHeld(next);
  }, [playerRef]);

  const releaseInput = useCallback(() => {
    const pointers = [...pointersRef.current.entries()];
    pointersRef.current.clear();
    for (const key of heldRef.current) playerRef.current?.setButtonPressed(key, false);
    heldRef.current = new Set();
    setHeld(new Set());
    for (const [id, { element }] of pointers) {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, [playerRef]);

  useEffect(() => {
    setDraft(null);
  }, [mobile, immersive, orientation]);

  useEffect(() => {
    releaseInput();
    const onVisibility = () => { if (document.hidden) releaseInput(); };
    window.addEventListener("blur", releaseInput);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", releaseInput);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseInput();
    };
  }, [mobile, immersive, orientation, rotation, editing, releaseInput]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const area = areaRef.current;
    if (!surface || !area) return;
    // A CSS-rotated surface has different physical safe-area edges.
    const edges = rotation === 90 ? ["right", "bottom", "left", "top"]
      : rotation === -90 ? ["left", "top", "right", "bottom"]
        : ["top", "right", "bottom", "left"];
    ["top", "right", "bottom", "left"].forEach((edge, index) => {
      surface.style.setProperty(`--play-safe-${edge}`, `env(safe-area-inset-${edges[index]}, 0px)`);
    });
    if (!mobile) return;
    const fit = () => {
      const { clientWidth: width, clientHeight: height } = area;
      const toolbarHeight = toolbarRef.current?.offsetHeight ?? 0;
      const top = portrait ? Math.min(toolbarHeight + 12, height) : 0;
      const screenHeight = Math.min(width * 0.75, height - top);
      const screenTravel = Math.max(0, height - top - screenHeight);
      travelRef.current.screen = { x: 0, y: screenTravel };
      area.style.setProperty("--screen-y", `${top + positions.screen * screenTravel}px`);
      area.style.setProperty("--screen-height", `${screenHeight}px`);
      const baseSize = Math.min(64, width * 0.17, height * 0.2);
      for (const element of area.querySelectorAll<HTMLElement>("[data-play-control]")) {
        const id = element.dataset.playControl as ControlId;
        const control = positions.buttons[id];
        const base = baseSize * control.size;
        const optional = controlDefinitions[id].optional;
        const desiredWidth = base * (id === "dpad" ? 2.7 : optional ? 1.55 : 1);
        const desiredHeight = base * (id === "dpad" ? 2.7 : optional ? 0.72 : 1);
        const fitScale = desiredWidth && desiredHeight ? Math.min(1, width / desiredWidth, height / desiredHeight) : 1;
        const controlWidth = desiredWidth * fitScale;
        const controlHeight = desiredHeight * fitScale;
        const travel = { x: Math.max(0, width - controlWidth), y: Math.max(0, height - controlHeight) };
        travelRef.current[id] = travel;
        element.style.setProperty("--control-x", `${control.x * travel.x}px`);
        element.style.setProperty("--control-y", `${control.y * travel.y}px`);
        element.style.setProperty("--control-width", `${controlWidth}px`);
        element.style.setProperty("--control-height", `${controlHeight}px`);
        element.style.setProperty("--control-opacity", String(control.opacity));
        element.style.setProperty("--control-font-size", `${controlHeight * (optional ? 0.32 : 0.4)}px`);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, [mobile, portrait, rotation, positions]);

  function localPoint(event: PointerEvent<HTMLElement>): Point {
    return rotation === 90 ? { x: event.clientY, y: -event.clientX }
      : rotation === -90 ? { x: -event.clientY, y: event.clientX }
        : { x: event.clientX, y: event.clientY };
  }

  function updateControl(id: ControlId, change: Partial<ControlPlacement>) {
    setDraft((current) => current && { ...current, buttons: { ...current.buttons, [id]: { ...current.buttons[id], ...change } } });
  }

  function finishEditing(save = false) {
    if (save && draft) onSaveLayout(orientation, draft);
    setDraft(null);
    playerHostRef.current?.querySelector("iframe")?.contentDocument
      ?.querySelector<HTMLCanvasElement>("canvas")?.focus({ preventScroll: true });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function endPointer(event: PointerEvent<HTMLElement>) {
    updatePointer(event.pointerId, [], event.currentTarget);
  }

  function dpadButtons(event: PointerEvent<HTMLElement>): PlayerButton[] {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const x = (rotation === 90 ? dy : rotation === -90 ? -dy : dx) / (event.currentTarget.clientWidth / 2);
    const y = (rotation === 90 ? -dx : rotation === -90 ? dx : dy) / (event.currentTarget.clientHeight / 2);
    if (Math.abs(x) > 1.25 || Math.abs(y) > 1.25) return [];
    const buttons: PlayerButton[] = [];
    if (Math.abs(x) > 0.28) buttons.push(x < 0 ? "left" : "right");
    if (Math.abs(y) > 0.28) buttons.push(y < 0 ? "up" : "down");
    return buttons;
  }

  function keyboardInput(key: PlayerButton, pressed: boolean, event: KeyboardEvent<HTMLButtonElement>) {
    if (editing || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    updatePointer(-buttonKeys.indexOf(key) - 1, pressed ? [key] : [], event.currentTarget);
  }

  function inputProps(key: PlayerButton) {
    return {
      "aria-pressed": held.has(key),
      "data-pressed": held.has(key),
      tabIndex: editing ? -1 : 0,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (editing || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        updatePointer(event.pointerId, [key], event.currentTarget);
      },
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onLostPointerCapture: endPointer,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => keyboardInput(key, true, event),
      onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => keyboardInput(key, false, event),
      onBlur: (event: { currentTarget: HTMLButtonElement }) => updatePointer(-buttonKeys.indexOf(key) - 1, [], event.currentTarget),
    };
  }

  function dragHandle(target: DragTarget, label: string) {
    if (!editing || (target === "screen" && !portrait)) return null;
    return (
      <Button
        aria-label={`${target === "screen" ? "上下" : "自由"}移动${label}`}
        aria-pressed={target !== "screen" && target === selected}
        className="absolute inset-0 z-20 h-full w-full touch-none cursor-move select-none rounded-lg border-2 border-dashed border-white/70 bg-transparent p-0 text-white hover:bg-white/10 hover:text-white aria-pressed:border-yellow-300 aria-pressed:ring-2 aria-pressed:ring-yellow-300"
        onPointerDown={(event) => {
          if (event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          if (target !== "screen") setSelected(target);
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId, target, element: event.currentTarget,
            start: localPoint(event),
            position: target === "screen" ? { x: 0, y: positions.screen } : positions.buttons[target],
            travel: travelRef.current[target] ?? { x: 0, y: 0 },
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const point = localPoint(event);
          const dx = point.x - drag.start.x;
          const dy = point.y - drag.start.y;
          if (Math.hypot(dx, dy) > 3) setDragging(true);
          const x = drag.travel.x > 0 ? clampPosition(drag.position.x + dx / drag.travel.x) : drag.position.x;
          const y = drag.travel.y > 0 ? clampPosition(drag.position.y + dy / drag.travel.y) : drag.position.y;
          if (drag.target === "screen") setDraft((current) => current && { ...current, screen: y });
          else updateControl(drag.target, { x, y });
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const dx = event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
          const dy = event.key === "ArrowUp" ? -0.02 : event.key === "ArrowDown" ? 0.02 : 0;
          if (target === "screen") setDraft((current) => current && { ...current, screen: clampPosition(current.screen + dy) });
          else updateControl(target, { x: clampPosition(positions.buttons[target].x + dx), y: clampPosition(positions.buttons[target].y + dy) });
        }}
        type="button"
        variant="outline"
      >
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded bg-zinc-950 px-1.5 py-0.5 text-[10px]">{target === "screen" ? "↕ " : ""}{label}</span>
      </Button>
    );
  }

  return (
    <div
      className={rotation === 90
        ? "absolute left-1/2 top-1/2 h-[100dvw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 rotate-90"
        : rotation === -90
          ? "absolute left-1/2 top-1/2 h-[100dvw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 -rotate-90"
          : "absolute inset-0"}
      id="web-player-surface"
      ref={surfaceRef}
    >
      <div
        className={mobile
          ? "absolute bottom-[max(0.75rem,var(--play-safe-bottom))] left-[max(0.75rem,var(--play-safe-left))] right-[max(0.75rem,var(--play-safe-right))] top-[max(0.75rem,var(--play-safe-top))]"
          : "absolute inset-0"}
        onContextMenu={(event) => { if (mobile) event.preventDefault(); }}
        ref={areaRef}
      >
        <div className={mobile && portrait ? "absolute left-0 top-(--screen-y) z-0 h-(--screen-height) w-full" : "absolute inset-0 z-0"}>
          <div className={editing ? "pointer-events-none h-full w-full" : "h-full w-full"} id="web-player-host" ref={playerHostRef} />
          {dragHandle("screen", "游戏画面")}
        </div>
        {placeholder}

        {mobile ? controlIds.filter((id) => positions.buttons[id].visible).map((id) => (
          <div
            className={`absolute left-(--control-x) top-(--control-y) h-(--control-height) w-(--control-width) ${editing && selected === id ? "z-20" : "z-10"}`}
            data-play-control={id}
            key={id}
          >
            {id === "dpad" ? (
              <div
                aria-label="方向键"
                className="grid h-full w-full touch-none select-none grid-cols-3 grid-rows-3 opacity-(--control-opacity)"
                onPointerDown={(event) => {
                  if (editing || event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  // Keep the pointer even in the neutral zone so sliding can resume input.
                  updatePointer(event.pointerId, dpadButtons(event), event.currentTarget, true);
                }}
                onPointerMove={(event) => {
                  if (!editing && event.currentTarget.hasPointerCapture(event.pointerId)) {
                    updatePointer(event.pointerId, dpadButtons(event), event.currentTarget, true);
                  }
                }}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onLostPointerCapture={endPointer}
                role="group"
              >
                {directions.map(({ key, label, Icon, className }) => (
                  <Button
                    {...inputProps(key)}
                    aria-label={label}
                    className={`${controlButtonClass} rounded-sm ${className}`}
                    key={key}
                    onPointerDown={undefined}
                    type="button"
                    variant="outline"
                  ><Icon aria-hidden /></Button>
                ))}
                <div aria-hidden className="pointer-events-none col-start-2 row-start-2 bg-zinc-800" />
              </div>
            ) : (
              <Button
                {...inputProps(id)}
                aria-label={id === "decision" ? "A 确认" : id === "cancel" ? "B 取消或菜单" : controlDefinitions[id].label}
                className={`${controlButtonClass} text-(length:--control-font-size) opacity-(--control-opacity)`}
                type="button"
                variant="outline"
              >{controlDefinitions[id].label}</Button>
            )}
            {dragHandle(id, controlDefinitions[id].label)}
          </div>
        )) : null}

        {toolbar || mobile ? (
          <div
            className={`${editing ? "pointer-events-none invisible " : ""}${mobile
              ? portrait
                ? "absolute right-0 top-0 z-30 flex max-w-full flex-wrap justify-end gap-2"
                : "absolute left-0 top-0 z-30 flex flex-col items-start gap-1"
              : "absolute right-3 top-3 z-30 flex flex-wrap justify-end gap-2"}`}
            ref={toolbarRef}
          >
            {toolbar}
            {mobile ? (
              <Button aria-label="调整按钮布局" className={overlayButtonClass} onClick={() => { setSelected("decision"); setDraft(layout); }} size="icon" title="调整布局" type="button" variant="outline">
                <Settings2 aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        {editing ? (
          <WebPlayLayoutEditor
            dragging={dragging}
            layout={draft}
            onCancel={() => finishEditing()}
            onChange={updateControl}
            onReset={() => { setSelected("decision"); setDraft(defaultControlLayouts[orientation]); }}
            onSave={() => finishEditing(true)}
            onSelect={setSelected}
            orientation={orientation}
            selected={selected}
          />
        ) : null}
        {feedback}
      </div>
    </div>
  );
}
