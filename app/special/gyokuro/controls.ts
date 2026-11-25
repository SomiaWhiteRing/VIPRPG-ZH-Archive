import type { KeyboardEvent } from "react";
import type { UiLocale } from "@/lib/i18n/locale";
import type { useMessages } from "@/lib/i18n/react";
import type { BitmapFont } from "./bitmap-font";
import { chartHeight, colors, fitScopeLabel, type FittedScopeLabel, type layoutChartHeader, type pixelPainter, type ScopeLabel } from "./chart";
import { scopes, type Scope } from "./model";

export type DateFilter = { from: string; to: string };
export type Calendar = { field: keyof DateFilter; month: number };
export type DrawerKind = "scope" | "dates";
export type ScopeLabels = Record<Scope, ScopeLabel>;
export type Hit = {
  id: string; text: string; label: string; x: number; y: number; w: number; h: number;
  selected?: boolean; inRange?: boolean; disabled?: boolean; caption?: FittedScopeLabel;
};

type Messages = ReturnType<typeof useMessages>;

export function layoutPage(t: Messages, options: {
  personal: boolean; sort: string; dates: string; scope: string; rows: number; canExport: boolean;
  header: ReturnType<typeof layoutChartHeader>;
}) {
  const { personal, sort, dates, scope, rows, canExport, header } = options;
  const bottom = chartHeight(rows, header.extra);
  const dateHit = { id: "dates", text: dates, label: t("gyokuro.dates"), ...header.dates };
  const scopeHit = { id: "scope", text: scope, label: scope, disabled: !personal, ...header.scope };
  const hits: Hit[] = [
    { id: "sort", text: sort, label: sort, x: 223, y: 17, w: 85, h: 21 },
    ...(header.extra ? [dateHit, scopeHit] : [scopeHit, dateHit]),
  ];
  hits.push(
    { id: "game", text: t("gyokuro.gameBack"), label: t("gyokuro.gameBack"), x: 12, y: bottom, w: 112, h: 30 },
    { id: "export", text: t("gyokuro.png"), label: t("gyokuro.png"), x: 162, y: bottom, w: 146, h: 30, disabled: !canExport },
  );
  return { hits, height: bottom + 42 };
}

export const shiftMonth = (month: number, offset: number) => {
  const date = new Date(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.getTime();
};

export function layoutDrawer(
  t: Messages, locale: UiLocale, kind: DrawerKind, dates: DateFilter, calendar: Calendar, busy: boolean,
  scopeLabels: ScopeLabels, font: BitmapFont,
) {
  const title = t(kind === "scope" ? "gyokuro.scope" : "gyokuro.dates");
  const hits: Hit[] = [];
  function add(id: string, text: string, x: number, y: number, w: number, h: number, extra?: Partial<Hit>) {
    hits.push({ id, text, label: text, x, y, w, h, ...extra });
  }
  add("close", "X", 272, 4, 36, 36, { label: t("core.action.close") });
  if (kind === "scope") {
    scopes.forEach((scope, index) => {
      const label = scopeLabels[scope];
      add(scope, "", 12, 48 + index * 46, 296, 40, {
        label: label.name + label.suffix, caption: fitScopeLabel(label, 280, font),
      });
    });
    return { title, hits, height: 194, monthHeading: null };
  }
  (["from", "to"] as const).forEach((field, i) => {
    const label = t(`gyokuro.${field}`);
    add(field, dates[field] || label, 12 + i * 150, 48, 146, 36, {
      label: dates[field] ? `${label} ${dates[field]}` : label,
      selected: calendar.field === field,
    });
  });

  const date = new Date(calendar.month);
  const month = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekday.format(Date.UTC(2024, 0, 1 + i)));
  add("prev", "‹", 12, 92, 44, 32, { label: t("gyokuro.prev") });
  add("next", "›", 264, 92, 44, 32, { label: t("gyokuro.next") });

  const prefix = date.toISOString().slice(0, 7);
  const start = (date.getUTCDay() + 6) % 7;
  const last = new Date(shiftMonth(calendar.month, 1) - 1).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const cell = start + day - 1;
    const value = `${prefix}-${String(day).padStart(2, "0")}`;
    add(value, String(day), 13 + cell % 7 * 42, 145 + Math.floor(cell / 7) * 36, 39, 33, {
      label: value,
      selected: dates.from === value || dates.to === value,
      inRange: !!dates.from && !!dates.to && value > dates.from && value < dates.to,
    });
  }
  add("reset", t("gyokuro.clear"), 12, 369, 146, 38, { disabled: busy });
  add("apply", t("gyokuro.apply"), 162, 369, 146, 38, { selected: true, disabled: busy });
  return { title, hits, height: 419, monthHeading: { text: month.format(date), weekdays } };
}

export function drawHit(painter: ReturnType<typeof pixelPainter>, hit: Hit, focused: boolean, border = colors.border) {
  const { x, y, w, h } = hit;
  const edge = focused ? colors.white : hit.selected && !hit.disabled ? colors.aqua : border;
  const fill = hit.selected || hit.inRange ? "#1a3844" : colors.panel;
  painter.frame(x, y, w, h, edge, fill);
  painter.text(hit.text, Math.floor(x + w / 2), Math.floor(y + (h - 12) / 2), hit.disabled ? colors.dim : colors.white, {
    align: "center", maxWidth: w - 10,
  });
}

export function canvasHit(hits: Hit[], el: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = el.getBoundingClientRect();
  const x = (clientX - bounds.left) * el.width / bounds.width;
  const y = (clientY - bounds.top) * el.height / bounds.height;
  return hits.find(hit => !hit.disabled && x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h);
}

export function handleCanvasKey(
  event: KeyboardEvent<HTMLCanvasElement>, hits: Hit[], focus: string | null, move: (id: string) => void,
  activate: (id: string) => void, scrollContainer?: HTMLElement | null,
) {
  const active = hits.filter(hit => !hit.disabled);
  const index = active.findIndex(hit => hit.id === focus);
  if (event.key === "Enter" || event.key === " ") {
    const hit = active[index] ?? active[0];
    if (!hit) return;
    event.preventDefault();
    activate(hit.id);
    return;
  }
  if (!["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const backwards = event.shiftKey || event.key === "ArrowLeft" || event.key === "ArrowUp";
  const nextIndex = index < 0 ? (backwards ? active.length - 1 : 0) : index + (backwards ? -1 : 1);
  const next = scrollContainer ? active[(nextIndex + active.length) % active.length] : active[nextIndex];
  if (!next) return;
  event.preventDefault();
  move(next.id);
  const canvas = event.currentTarget;
  const bounds = canvas.getBoundingClientRect();
  const clip = scrollContainer?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const top = bounds.top + next.y * bounds.height / canvas.height;
  const bottom = top + next.h * bounds.height / canvas.height;
  if (top < clip.top) (scrollContainer ?? window).scrollBy(0, top - clip.top - 8);
  else if (bottom > clip.bottom) (scrollContainer ?? window).scrollBy(0, bottom - clip.bottom + 8);
}
