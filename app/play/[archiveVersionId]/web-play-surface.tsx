import { Button } from "@/app/components/ui/button";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Settings2 } from "lucide-react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { defaultControlLayouts } from "./web-play-controls-preferences";
import type { ControlLayout, DisplayOrientation } from "./web-play-controls-preferences";
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
const controlButtonClass = "h-full min-h-0 w-full touch-none select-none rounded-full border-2 border-white/55 bg-black/45 p-0 text-white shadow-lg backdrop-blur-sm hover:bg-white/20 hover:text-white data-[pressed=true]:border-white data-[pressed=true]:bg-white/45 [&_svg]:size-6";
const directions = [
  { key: "up", label: "上", Icon: ArrowUp, className: "col-start-2 row-start-1" },
  { key: "left", label: "左", Icon: ArrowLeft, className: "col-start-1 row-start-2" },
  { key: "right", label: "右", Icon: ArrowRight, className: "col-start-3 row-start-2" },
  { key: "down", label: "下", Icon: ArrowDown, className: "col-start-2 row-start-3" },
] as const;
const buttonKeys: PlayerButton[] = ["up", "left", "right", "down", "decision", "cancel", "shift"];
const clampPosition = (value: number) => Math.max(0, Math.min(1, value));

export function WebPlaySurface({
  mobile, immersive, orientation, rotation, layout, onSaveLayout,
  playerRef, playerHostRef, toolbar, placeholder, feedback,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ControlLayout | null>(null);
  const [held, setHeld] = useState<Set<PlayerButton>>(new Set());
  const heldRef = useRef(new Set<PlayerButton>());
  const pointersRef = useRef(new Map<number, { buttons: PlayerButton[]; element: HTMLElement }>());
  const travelRef = useRef<ControlLayout>({ screen: 0, dpad: 0, actions: 0 });
  const dragRef = useRef<{
    pointerId: number; target: keyof ControlLayout; element: HTMLElement;
    startY: number; startPosition: number; travel: number;
  } | null>(null);
  const portrait = orientation === "portrait";
  const editing = mobile && portrait && draft !== null;
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
      const controlSize = Math.min(168, width * 0.46, Math.max(132, height * 0.42), height - top);
      const screenHeight = Math.min(width * 0.75, height - top);
      travelRef.current = {
        screen: Math.max(0, height - top - screenHeight),
        dpad: Math.max(0, height - top - controlSize),
        actions: Math.max(0, height - top - controlSize),
      };
      for (const key of ["screen", "dpad", "actions"] as const) {
        area.style.setProperty(`--${key}-y`, `${top + positions[key] * travelRef.current[key]}px`);
      }
      area.style.setProperty("--control-size", `${controlSize}px`);
      area.style.setProperty("--screen-height", `${screenHeight}px`);
      area.style.setProperty("--toolbar-height", `${toolbarHeight}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, [mobile, portrait, rotation, positions]);

  function localY(event: PointerEvent<HTMLElement>) {
    return rotation === 90 ? -event.clientX : rotation === -90 ? event.clientX : event.clientY;
  }

  function finishEditing(save = false) {
    if (save && draft) onSaveLayout(orientation, draft);
    setDraft(null);
    playerHostRef.current?.querySelector("iframe")?.contentDocument
      ?.querySelector<HTMLCanvasElement>("canvas")?.focus({ preventScroll: true });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
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

  function dragHandle(target: keyof ControlLayout, label: string) {
    if (!editing) return null;
    return (
      <Button
        aria-describedby="web-play-layout-help"
        aria-label={`上下移动${label}`}
        className="absolute inset-0 z-20 h-full w-full touch-none cursor-ns-resize select-none border-2 border-dashed border-white bg-black/25 p-1 text-white hover:bg-black/35 hover:text-white"
        onPointerDown={(event) => {
          if (event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId, target, element: event.currentTarget,
            startY: localY(event), startPosition: positions[target], travel: travelRef.current[target],
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || drag.travel <= 0) return;
          const position = clampPosition(drag.startPosition + (localY(event) - drag.startY) / drag.travel);
          setDraft((current) => current && { ...current, [drag.target]: position });
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const position = event.key === "Home" ? 0 : event.key === "End" ? 1
            : clampPosition(positions[target] + (event.key === "ArrowUp" ? -0.02 : 0.02));
          setDraft((current) => current && { ...current, [target]: position });
        }}
        type="button"
        variant="outline"
      >
        <span className="rounded bg-black/75 px-2 py-1 text-xs">↕ {label}</span>
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
        <div className={mobile && portrait ? "absolute left-0 top-(--screen-y) h-(--screen-height) w-full" : "absolute inset-0"}>
          <div className={editing ? "pointer-events-none h-full w-full" : "h-full w-full"} id="web-player-host" ref={playerHostRef} />
          {dragHandle("screen", "游戏画面")}
        </div>
        {placeholder}

        {mobile ? (
          <>
            <div
              aria-label="方向键"
              className="absolute left-0 top-(--dpad-y) z-10 grid size-(--control-size) touch-none select-none grid-cols-3 grid-rows-3 gap-0.5 rounded-full bg-black/15"
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
                  className={`${controlButtonClass} ${className}`}
                  key={key}
                  onPointerDown={undefined}
                  type="button"
                  variant="outline"
                ><Icon aria-hidden /></Button>
              ))}
              {dragHandle("dpad", "方向键")}
            </div>
            <div aria-label="操作键" className="absolute right-0 top-(--actions-y) z-10 grid size-(--control-size) grid-cols-2 grid-rows-2 gap-2" role="group">
              <Button {...inputProps("shift")} aria-label="Shift 辅助键" className={`${controlButtonClass} col-span-2 self-center rounded-2xl`} type="button" variant="outline">Shift</Button>
              <Button {...inputProps("cancel")} aria-label="X 取消或菜单" className={controlButtonClass} type="button" variant="outline">
                <span className="flex flex-col text-lg leading-tight">X<span className="text-[10px]">取消</span></span>
              </Button>
              <Button {...inputProps("decision")} aria-label="Z 确认" className={controlButtonClass} type="button" variant="outline">
                <span className="flex flex-col text-lg leading-tight">Z<span className="text-[10px]">确认</span></span>
              </Button>
              {dragHandle("actions", "操作键")}
            </div>
          </>
        ) : null}

        {toolbar || (mobile && portrait) ? (
          <div
            className={mobile
              ? portrait
                ? "absolute right-0 top-0 z-30 flex max-w-full flex-wrap justify-end gap-2"
                : "absolute left-0 top-0 z-30 flex flex-col items-start gap-1"
              : "absolute right-3 top-3 z-30 flex flex-wrap justify-end gap-2"}
            ref={toolbarRef}
          >
            {toolbar}
            {mobile && portrait ? (
              <Button aria-label="调整按钮和画面位置" aria-pressed={editing} className={overlayButtonClass} onClick={() => editing ? finishEditing() : setDraft(layout)} size="icon" title="调整布局" type="button" variant="outline">
                <Settings2 aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        {editing ? (
          <div className="absolute left-0 right-0 top-[calc(var(--toolbar-height)+0.5rem)] z-30 rounded-lg bg-black/85 p-2 text-white">
            <p className="m-0 mb-2 text-center text-xs" id="web-play-layout-help">上下拖动画面、方向键或操作键</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button className={overlayButtonClass} onClick={() => setDraft(defaultControlLayouts.portrait)} size="sm" type="button" variant="outline">恢复默认</Button>
              <Button className={overlayButtonClass} onClick={() => finishEditing()} size="sm" type="button" variant="outline">取消</Button>
              <Button className={overlayButtonClass} onClick={() => finishEditing(true)} size="sm" type="button" variant="outline">保存</Button>
            </div>
          </div>
        ) : null}
        {feedback}
      </div>
    </div>
  );
}
