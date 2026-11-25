import type { BitmapFont } from "./bitmap-font";

export const chartWidth = 320;
export const chartHeight = (rows: number, extra = 0) => 105 + 34 * rows + extra;
const pixelTextWidth = (font: BitmapFont, text: string) => [...text].reduce((width, char) => width + font(char).advance, 0);

export type ChartText = {
  title: string;
  sort: string;
  matches: string;
  dates: string;
  fighter: string;
  usage: string;
  win: string;
};

export type ScopeLabel = { name: string; suffix: string; avatar: boolean };
const avatarWidth = 12;
const avatarGap = 4;

export function fitScopeLabel(label: ScopeLabel, maxWidth: number, font: BitmapFont) {
  const suffixWidth = pixelTextWidth(font, label.suffix);
  const occupied = suffixWidth + (label.avatar ? avatarWidth + avatarGap : 0);
  const budget = maxWidth - occupied;
  let name = label.name;
  if (pixelTextWidth(font, name) > budget) {
    let prefix = "";
    for (const { segment } of new Intl.Segmenter().segment(name)) {
      if (pixelTextWidth(font, `${prefix}${segment}…`) > budget) break;
      prefix += segment;
    }
    name = `${prefix}…`;
  }
  return { ...label, name, width: occupied + pixelTextWidth(font, name) };
}

export type FittedScopeLabel = ReturnType<typeof fitScopeLabel>;

export function layoutChartHeader(labels: ChartText, scope: ScopeLabel, font: BitmapFont) {
  const caption = fitScopeLabel(scope, 280, font);
  const scopeWidth = caption.width + 16;
  const dateWidth = pixelTextWidth(font, labels.dates) + 16;
  const dates = { x: 308 - dateWidth, y: 47, w: dateWidth, h: 24 };
  const available = dates.x - 6 - (15 + Math.min(80, pixelTextWidth(font, labels.matches)) + 6);
  const extra = scopeWidth > available ? 28 : 0;
  return {
    dates, extra,
    scope: { x: (extra ? 308 : dates.x - 6) - scopeWidth, y: 47 + extra, w: scopeWidth, h: 24, caption },
  };
}

export type ChartRow = {
  icon: number;
  usage: number;
  win: number;
  count: string;
  record: string;
};

export const colors = { ink: "#0b101d", panel: "#132334", border: "#385875", white: "#e4f5fa", dim: "#96b5c5", aqua: "#5cf1da", blue: "#59baf5" };

export function pixelPainter(ctx: CanvasRenderingContext2D, font: BitmapFont) {
  function rect(x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function text(value: string, x: number, y: number, color: string, options: {
    scale?: number;
    align?: "left" | "center" | "right";
    maxWidth?: number;
  } = {}) {
    const { scale = 1, align = "left", maxWidth = chartWidth - x } = options;
    if (!value) return;
    const chars = [...value];
    const glyphs = chars.map(font);
    const advance = glyphs.reduce((total, glyph) => total + glyph.advance, 0);
    if (!advance) return;
    const width = Math.min(advance * scale, maxWidth);
    const scaleX = width / advance;
    if (align !== "left") x -= Math.floor(width / (align === "center" ? 2 : 1));
    let offset = 0;
    let previous: { offset: number; width: number } | undefined;
    glyphs.forEach((glyph, index) => {
      // Match the Sea's zero-advance marks, including marks that join two cells.
      const start = !glyph.advance && previous
        ? previous.offset + ("͜͟͢͝͞͠͡".includes(chars[index]) ? previous.width - glyph.width / 2 : Math.floor((previous.width - glyph.width) / 2))
        : offset;
      glyph.rows.forEach((bits, row) => {
        for (let col = 0; col < glyph.width; col++) {
          if (!(bits & (1 << col))) continue;
          const left = Math.max(0, Math.round((start + col) * scaleX));
          const right = Math.min(width, Math.round((start + col + 1) * scaleX));
          if (right > left) rect(x + left, y + row * scale, right - left, scale, color);
        }
      });
      if (glyph.advance) previous = { offset, width: glyph.width };
      offset += glyph.advance;
    });
  }

  function frame(x: number, y: number, w: number, h: number, edge: string, fill: string) {
    for (let row = 0; row < h; row++) {
      const left = Math.max(0, 4 - row);
      const right = Math.max(0, 5 - h + row);
      rect(x + left, y + row, w - left - right, 1, edge);
      if (row > 0 && row < h - 1) rect(x + left + 1, y + row, w - left - right - 2, 1, fill);
    }
  }
  return { rect, text, frame };
}

export function drawScopeLabel(
  ctx: CanvasRenderingContext2D, painter: ReturnType<typeof pixelPainter>, caption: FittedScopeLabel,
  avatar: HTMLImageElement | null, x: number, y: number, w: number, h: number,
) {
  let left = x + Math.floor((w - caption.width) / 2);
  const top = y + Math.floor((h - 12) / 2);
  if (caption.avatar) {
    if (avatar) {
      const side = Math.min(avatar.naturalWidth, avatar.naturalHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(avatar, (avatar.naturalWidth - side) / 2, (avatar.naturalHeight - side) / 2, side, side,
        left, top, avatarWidth, avatarWidth);
    }
    left += avatarWidth + avatarGap;
  }
  const maxWidth = caption.width - (caption.avatar ? avatarWidth + avatarGap : 0);
  painter.text(caption.name + caption.suffix, left, top, colors.white, { maxWidth });
}

export function drawGyokuroChart(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  labels: ChartText,
  rows: ChartRow[],
  usageMax: number,
  header: ReturnType<typeof layoutChartHeader>,
  avatar: HTMLImageElement | null,
  font: BitmapFont,
  focus?: string | null,
) {
  const painter = pixelPainter(ctx, font);
  const { rect, text, frame } = painter;
  const { extra, scope, dates } = header;

  function meter(x: number, y: number, fraction: number, max: number, color: string) {
    rect(x, y, 108, 5, "#253d50");
    const filled = Math.round(108 * fraction * 100 / max);
    if (filled > 0) rect(x, y, filled, 5, color);
  }

  ctx.imageSmoothingEnabled = false;
  rect(0, 0, chartWidth, chartHeight(rows.length, extra), colors.ink);
  ctx.drawImage(atlas, 0, 0, chartWidth, 76, 0, 0, chartWidth, 76);
  rect(0, 0, chartWidth, 76, "#0b101db8");
  const titleWidth = labels.title.length > 4 ? 172 : 118;
  frame(12, 10, titleWidth, 34, colors.aqua, colors.ink);
  text(labels.title, 23, 14, colors.aqua, { scale: 2, maxWidth: titleWidth - 22 });
  frame(223, 17, 85, 21, focus === "sort" ? colors.white : colors.blue, colors.ink);
  text(labels.sort, 265, 21, colors.white, { align: "center", maxWidth: 77 });
  text(labels.matches, 15, 53, colors.white, { maxWidth: 80 });
  frame(dates.x, dates.y, dates.w, dates.h, focus === "dates" ? colors.white : colors.blue, colors.ink);
  text(labels.dates, dates.x + Math.floor(dates.w / 2), dates.y + 6, colors.white, { align: "center", maxWidth: dates.w - 16 });
  frame(scope.x, scope.y, scope.w, scope.h, focus === "scope" ? colors.white : colors.blue, colors.ink);
  drawScopeLabel(ctx, painter, scope.caption, avatar, scope.x, scope.y, scope.w, scope.h);
  rect(12, 72 + extra, 296, 1, colors.border);

  ctx.save();
  ctx.translate(0, extra);
  text(labels.fighter, 17, 79, colors.white, { maxWidth: 42 });
  text(labels.usage, 64, 79, colors.blue, { maxWidth: 64 });
  text(`0-${usageMax}%`, 172, 79, colors.dim, { align: "right", maxWidth: 42 });
  text(labels.win, 188, 79, colors.aqua, { maxWidth: 64 });
  text("0-100%", 296, 79, colors.dim, { align: "right", maxWidth: 42 });

  rows.forEach(({ usage, win, count, record, icon }, index) => {
    const y = 96 + index * 34;
    frame(12, y, 296, 32, colors.border, index % 2 === 0 ? colors.panel : "#101c2b");
    rect(21, y + 3, 28, 26, "#0a1523");
    ctx.drawImage(atlas, icon % 12 * 24, 76 + Math.floor(icon / 12) * 24, 24, 24, 23, y + 4, 24, 24);
    text(chartPercent(usage), 64, y + 5, colors.white);
    text(count, 172, y + 5, colors.dim, { align: "right", maxWidth: 62 });
    text(chartPercent(win), 188, y + 5, colors.white);
    text(record, 296, y + 5, colors.dim, { align: "right", maxWidth: 62 });
    meter(64, y + 21, usage, usageMax, colors.blue);
    meter(188, y + 21, win, 100, colors.aqua);
  });
  ctx.restore();
}

export const chartPercent = (ratio: number) => ratio === 0 ? "0%" : `${(ratio * 100).toFixed(2)}%`;
