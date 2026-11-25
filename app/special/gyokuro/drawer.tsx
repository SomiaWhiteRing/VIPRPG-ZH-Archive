import { useRef, useState } from "react";
import * as Dialog from "@/app/components/ui/dialog";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import type { BitmapFont } from "./bitmap-font";
import { chartWidth, colors, drawScopeLabel, pixelPainter } from "./chart";
import { canvasHit, drawHit, handleCanvasKey, layoutDrawer, shiftMonth, type DateFilter, type DrawerKind, type ScopeLabels } from "./controls";
import { defaultStatsStart, type Scope } from "./model";

const monthOf = (day: string) => Date.parse(`${day.slice(0, 7)}-01T00:00:00Z`);

export function GyokuroDrawer({ kind, filter, latest, busy, scopeLabels, font, avatar, close, restore, onScope, onDates }: {
  kind: DrawerKind;
  filter: DateFilter;
  latest: string;
  busy: boolean;
  scopeLabels: ScopeLabels;
  font: BitmapFont;
  avatar: HTMLImageElement | null;
  close: () => void;
  restore: () => void;
  onScope: (scope: Scope) => void;
  onDates: (dates: DateFilter) => void;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const view = useRef<HTMLCanvasElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [dates, setDates] = useState(filter);
  const [calendar, setCalendar] = useState({
    field: "from" as keyof DateFilter,
    month: monthOf(filter.from || filter.to || latest),
  });
  const visibleDates = { from: dates.from, to: dates.to || (latest >= dates.from ? latest : "") };
  const { title, hits, height, monthHeading } = layoutDrawer(t, locale, kind, visibleDates, calendar, busy, scopeLabels, font);

  function attachCanvas(element: HTMLCanvasElement | null) {
    view.current = element;
    const ctx = element?.getContext("2d");
    if (!ctx) return;
    const painter = pixelPainter(ctx, font);
    painter.frame(0, 0, chartWidth, height, colors.border, colors.ink);
    painter.text(title, 14, 18, colors.aqua, { maxWidth: 236 });
    painter.rect(12, 42, 296, 1, colors.border);
    if (monthHeading) {
      painter.text(monthHeading.text, 160, 102, colors.aqua, { align: "center", maxWidth: 192 });
      monthHeading.weekdays.forEach((day, index) => {
        painter.text(day, 32 + index * 42, 128, colors.dim, { align: "center", maxWidth: 36 });
      });
    }
    hits.forEach(hit => {
      const face = hit.id === "close" ? { ...hit, x: hit.x + 10, y: hit.y + 6, w: 26, h: 24 } : hit;
      drawHit(painter, face, hit.id === focus);
      if (hit.caption) drawScopeLabel(ctx, painter, hit.caption, avatar, hit.x, hit.y, hit.w, hit.h);
    });
  }

  function activate(id: string, keyboard = false) {
    if (id === "close") {
      close();
    } else if (id === "all" || id === "mine" || id === "others") {
      onScope(id);
    } else if (id === "apply" || id === "reset") {
      onDates(id === "apply" ? dates : { from: defaultStatsStart, to: "" });
    } else if (id === "prev" || id === "next") {
      setCalendar({ ...calendar, month: shiftMonth(calendar.month, id === "prev" ? -1 : 1) });
    } else if (id === "from" || id === "to") {
      setCalendar({ field: id, month: visibleDates[id] ? monthOf(visibleDates[id]) : calendar.month });
    } else if (calendar.field === "from") {
      setDates({ from: id, to: dates.to < id ? "" : dates.to });
      setCalendar({ ...calendar, field: "to" });
      if (keyboard) setFocus("to");
    } else {
      setDates(dates.from > id ? { from: id, to: dates.from } : { ...dates, to: id });
      if (keyboard) setFocus("apply");
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay asChild className="h-full w-full bg-transparent motion-safe:animate-character-menu-backdrop-open">
          <canvas data-gyokuro-backdrop width={1} height={1} aria-hidden ref={(element) => {
            const ctx = element?.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = "rgba(0, 0, 0, 0.64)";
            ctx.fillRect(0, 0, 1, 1);
          }} />
        </Dialog.Overlay>
        <Dialog.Content
          data-gyokuro-drawer ref={content} aria-describedby={undefined}
          className="inset-x-0 bottom-0 mx-auto max-h-dvh w-full overflow-y-auto overscroll-contain border-0 bg-transparent shadow-none outline-none [--popover-slide-offset:2rem] motion-safe:animate-popover-slide-open pointer-fine:top-1/2 pointer-fine:bottom-auto pointer-fine:max-w-[320px] pointer-fine:max-h-[calc(100dvh-2rem)] pointer-fine:-translate-y-1/2 pointer-fine:[--popover-slide-offset:0.5rem]"
          onOpenAutoFocus={event => {
            event.preventDefault();
            view.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            restore();
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <canvas
            ref={attachCanvas} width={chartWidth} height={height} tabIndex={0}
            className="block h-auto w-full outline-none [image-rendering:pixelated]"
            aria-label={title} aria-describedby="gyokuro-drawer-description"
            onKeyDown={event => handleCanvasKey(event, hits, focus, setFocus, id => activate(id, true), content.current)}
            onPointerMove={event => {
              event.currentTarget.style.cursor = canvasHit(hits, event.currentTarget, event.clientX, event.clientY) ? "pointer" : "";
            }}
            onClick={event => {
              const hit = canvasHit(hits, event.currentTarget, event.clientX, event.clientY);
              if (!hit) return;
              setFocus(null);
              activate(hit.id);
            }}
          />
          <div className="sr-only" id="gyokuro-drawer-description">
            <p>{t("gyokuro.board")}</p>
            <p aria-live="polite">{hits.find(hit => hit.id === focus)?.label}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
