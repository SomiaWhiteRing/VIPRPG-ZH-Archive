import glyphData from "./eternal-sea-glyphs.json";
import type { SeaGlyph } from "@/lib/dto/sea";

export const SEA_WINDOW_WIDTH = 320;
export const SEA_WINDOW_HEIGHT = 80;
export const SEA_TEXT_WIDTH = 228;
export const SEA_TEXT_TOP = 10;
export const SEA_LINE_HEIGHT = 16;
export const SEA_MAX_LINES = 4;
export const SEA_MAX_BODY_LINES = SEA_MAX_LINES - 1;
export const SEA_MAX_BODY_UNITS = 106;
export const SEA_ASSETS = "/assets/eternal-sea";
export type SeaDialogueSide = "left" | "right";

export function seaTextLeft(side: SeaDialogueSide) {
  return side === "right" ? 8 : 80;
}

const glyphs = new Map(glyphData.map(([code, width], index) => [code, { width, index }]));

export function seaGlyph(character: string) {
  return glyphs.get(character.codePointAt(0) ?? 65533) ?? glyphs.get(65533)!;
}

export function seaDisplayName(name: string) {
  const characters = Array.from(name);
  const maxWidth = SEA_TEXT_WIDTH - seaGlyph("：").width;
  if (characters.reduce((width, character) => width + seaGlyph(character).width, 0) <= maxWidth) return name;
  let result = "";
  let width = seaGlyph("…").width;
  for (const character of characters) {
    width += seaGlyph(character).width;
    if (width > maxWidth) break;
    result += character;
  }
  return `${result}…`;
}

function layoutSeaText(text: string, indentContinuation = false) {
  const lines = [""];
  const placements: { character: string; x: number; row: number; width: number }[] = [];
  const lineIndent = indentContinuation ? "　" : "";
  const indentWidth = indentContinuation ? seaGlyph(lineIndent).width : 0;
  let width = 0;
  for (const character of text) {
    if (character === "\n") {
      placements.push({ character, x: width, row: lines.length - 1, width: 0 });
      lines.push(lineIndent);
      width = indentWidth;
      continue;
    }
    const glyph = seaGlyph(character);
    if (width + glyph.width > SEA_TEXT_WIDTH) {
      lines.push(lineIndent);
      width = indentWidth;
    }
    placements.push({ character, x: width, row: lines.length - 1, width: glyph.width });
    lines[lines.length - 1] += character;
    width += glyph.width;
  }
  return { lines, placements };
}

function layoutSeaBody(body: string) {
  const normalized = body.replace(/\r\n?/g, "\n");
  const layout = layoutSeaText(`「${normalized}」`, true);
  const units = Array.from(normalized).reduce((total, character) => total + (character === "\n" ? 0 : seaGlyph(character).width / 6), 0);
  return { ...layout, units, fits: layout.lines.length <= SEA_MAX_BODY_LINES && units <= SEA_MAX_BODY_UNITS };
}

/** Keep the name on its own row and preserve explicit body line breaks. */
export function layoutSeaDialogue(name: string, body: string) {
  const layout = layoutSeaBody(body);
  const heading = `${seaDisplayName(name)}：`;
  const nameLayout = layoutSeaText(`${heading}\n`);
  return {
    ...layout,
    lines: [heading, ...layout.lines],
    placements: [...nameLayout.placements, ...layout.placements.map((glyph) => ({ ...glyph, row: glyph.row + 1 }))],
  };
}

/** Constrain committed input without joining or moving the user's line breaks. */
export function limitSeaBodyInput(body: string) {
  let result = "";
  for (const character of body.replace(/\r\n?/g, "\n")) {
    const candidate = result + character;
    if (!layoutSeaBody(candidate).fits) break;
    result = candidate;
  }
  return result;
}

const bitmaps = new Map<string, Promise<HTMLImageElement>>();
const fontBitmaps = new Map<string, Map<string, HTMLCanvasElement>>();
let fontMask: HTMLCanvasElement | undefined;

export function seaBitmap(url: string) {
  const cached = bitmaps.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const bitmap = new Image();
    bitmap.onload = () => resolve(bitmap);
    bitmap.onerror = () => {
      bitmaps.delete(url);
      reject(new Error("无法载入对话框图片"));
    };
    bitmap.src = url;
  });
  bitmaps.set(url, promise);
  return promise;
}

export function drawSeaDialogue(
  canvas: HTMLCanvasElement,
  images: { window: HTMLImageElement; faces?: HTMLImageElement },
  placements: SeaGlyph[],
  fontFamily: string,
  faceIndex: number,
  side: SeaDialogueSide = "left",
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, SEA_WINDOW_WIDTH, canvas.height);
  context.drawImage(images.window, 0, 0, SEA_WINDOW_WIDTH, canvas.height);
  if (images.faces) {
    context.save();
    context.translate(side === "right" ? 304 : 16, 16);
    if (side === "right") context.scale(-1, 1);
    context.drawImage(images.faces, (faceIndex % 4) * 48, Math.floor(faceIndex / 4) * 48, 48, 48, 0, 0, 48, 48);
    context.restore();
  }
  let rendered = fontBitmaps.get(fontFamily);
  if (!rendered) {
    rendered = new Map();
    fontBitmaps.set(fontFamily, rendered);
    if (fontBitmaps.size > 2) fontBitmaps.delete(fontBitmaps.keys().next().value!);
  }
  fontMask ??= document.createElement("canvas");
  if (fontMask.width !== 120) { fontMask.width = 120; fontMask.height = 120; }
  const maskContext = fontMask.getContext("2d")!;
  maskContext.font = `120px "${fontFamily}"`;
  maskContext.textBaseline = "alphabetic";
  const colors = [[240, 250, 255], [240, 250, 255], [213, 236, 253], [213, 236, 253],
    [187, 222, 252], [187, 222, 252], [161, 208, 251], [161, 208, 251],
    [135, 195, 250], [108, 181, 248], [82, 167, 247], [56, 153, 246]];
  for (const placement of placements) {
    if (placement.character === "\n") continue;
    let bitmap = rendered.get(placement.character);
    if (!bitmap) {
      // Sample inside enlarged font pixels, then apply the original System
      // palette and shadow. This avoids browser antialiasing changing the RTP art.
      maskContext.clearRect(0, 0, 120, 120);
      maskContext.fillText(placement.character, 0, 120);
      bitmap = document.createElement("canvas");
      bitmap.width = 14; bitmap.height = 14;
      const pixels = bitmap.getContext("2d", { willReadFrequently: true })!;
      pixels.imageSmoothingEnabled = false;
      pixels.drawImage(fontMask, 0, 0, 120, 120, 0, 0, 12, 12);
      const mask = pixels.getImageData(0, 0, 14, 14).data;
      const image = pixels.createImageData(14, 14);
      for (let y = 0; y < 12; y++) for (let x = 0; x < placement.width; x++) {
        if (mask[(y * 14 + x) * 4 + 3] >= 128) image.data.set([29, 29, 30, 255], ((y + 1) * 14 + x + 1) * 4);
      }
      for (let y = 0; y < 12; y++) for (let x = 0; x < placement.width; x++) {
        if (mask[(y * 14 + x) * 4 + 3] >= 128) image.data.set([...colors[y], 255], (y * 14 + x) * 4);
      }
      pixels.putImageData(image, 0, 0);
      rendered.set(placement.character, bitmap);
    }
    context.drawImage(bitmap, 0, 0, placement.width + 1, 13,
      seaTextLeft(side) + placement.x, SEA_TEXT_TOP + placement.row * SEA_LINE_HEIGHT, placement.width + 1, 13);
  }
}
