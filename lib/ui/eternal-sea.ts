import glyphData from "./eternal-sea-glyphs.json";
import { SEA_MESSAGE_REQUEST_BYTES, type SeaGlyph, type SeaSubmission } from "@/lib/dto/sea";

export const SEA_WINDOW_WIDTH = 320;
export const SEA_WINDOW_HEIGHT = 80;
export const SEA_TEXT_WIDTH = 228;
export const SEA_TEXT_TOP = 10;
export const SEA_LINE_HEIGHT = 16;
export const SEA_MAX_LINES = 4;
export const SEA_MAX_BODY_LINES = SEA_MAX_LINES - 1;
export const SEA_ASSETS = "/assets/eternal-sea";
export type SeaDialogueSide = "left" | "right";

export function seaTextLeft(side: SeaDialogueSide) {
  return side === "right" ? 8 : 80;
}

const glyphs = new Map(glyphData.map(([code, width, advance = width], index) => [code, { width, advance, index }]));

export function seaGlyph(character: string) {
  return glyphs.get(character.codePointAt(0) ?? 65533) ?? glyphs.get(65533)!;
}

export function seaDisplayName(name: string) {
  const characters = Array.from(name);
  const maxWidth = SEA_TEXT_WIDTH - seaGlyph("：").width;
  if (characters.reduce((width, character) => width + seaGlyph(character).advance, 0) <= maxWidth) return name;
  let result = "";
  let width = seaGlyph("…").width;
  for (const character of characters) {
    width += seaGlyph(character).advance;
    if (width > maxWidth) break;
    result += character;
  }
  return `${result}…`;
}

const colorCommand = /^\\[Cc]\[([0-9]+)\]$/;
const pendingParameter = /^\\[A-Za-z]\[(?:[0-9[\]]|\\[Vv])*\\?$/;
const utf8 = new TextEncoder();

function* seaBodyTokens(text: string) {
  // Index complete parameters on each line, including forms like \N[\V[1]].
  const bracketEnds = new Map<number, number>();
  const opens: number[] = [];
  for (const { 0: bracket, index } of text.matchAll(/[[\]\n]/g)) {
    if (bracket === "[") {
      opens.push(index);
    } else if (bracket === "\n") {
      opens.length = 0;
    } else {
      const start = opens.pop();
      if (start !== undefined) bracketEnds.set(start, index + 1);
    }
  }

  const tokens = /\\(?:([A-Za-z])|[^\n])?|[\s\S]/gu;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const end = match[1] ? bracketEnds.get(tokens.lastIndex) : undefined;
    if (end === undefined) {
      yield match[0];
    } else {
      tokens.lastIndex = end;
      yield text.slice(match.index, end);
    }
  }
}

function layoutSeaText(text: string, body: boolean, byteBudget = Infinity) {
  const opening = seaGlyph("「");
  const closing = seaGlyph("」");
  const placements: SeaGlyph[] = body ? [{ character: "「", x: 0, row: 0, width: opening.width }] : [];
  const indentWidth = body ? seaGlyph("　").advance : 0;
  const lastRow = body ? SEA_MAX_BODY_LINES - 1 : Infinity;
  const countBytes = text.length * 6 > byteBudget;
  let width = body ? opening.advance : 0;
  let row = 0;
  let end = 0;
  let color: number | undefined;
  let hasContent = false;
  let previous: SeaGlyph | undefined = placements[0];
  for (const source of body && text.includes("\\") ? seaBodyTokens(text) : text) {
    if (countBytes) {
      byteBudget -= utf8.encode(JSON.stringify(source)).length - 2;
      if (byteBudget < 0) break;
    }
    if (body && source.startsWith("\\") && source !== "\\\\") {
      const colorCode = colorCommand.exec(source);
      if (colorCode) {
        const index = Number(colorCode[1]);
        color = index > 0 && index <= 19 ? index : undefined;
      }
      end += source.length;
      continue;
    }
    const character = source === "\\\\" ? "\\" : source;
    if (character === "\n") {
      if (row === lastRow) break;
      placements.push({ character, x: width, row, width: 0 });
      row++;
      width = indentWidth;
      previous = undefined;
      end += source.length;
      continue;
    }
    const glyph = seaGlyph(character);
    // Earlier lines can use the full width because the quote can still wrap.
    const lineWidth = row === lastRow ? SEA_TEXT_WIDTH - closing.advance : SEA_TEXT_WIDTH;
    if (width + glyph.advance > lineWidth) {
      if (row === lastRow) break;
      row++;
      width = indentWidth;
    }
    end += source.length;
    hasContent ||= character.trim().length > 0 && glyph.width > 0;
    if (glyph.advance === 0) {
      // Combining marks keep their ink width but share the preceding cell.
      // Double marks span the boundary between that cell and the next.
      if (glyph.width > 0) placements.push({ character,
        x: previous ? previous.x + ("͜͟͢͝͞͠͡".includes(character) ? previous.width - glyph.width / 2 : Math.floor((previous.width - glyph.width) / 2)) : width,
        row: previous?.row ?? row, width: glyph.width, color });
      continue;
    }
    previous = { character, x: width, row, width: glyph.width, color };
    placements.push(previous);
    width += glyph.advance;
  }
  if (body) {
    if (width + closing.advance > SEA_TEXT_WIDTH) {
      row++;
      width = indentWidth;
    }
    placements.push({ character: "」", x: width, row, width: closing.width });
  }
  return { placements, hasContent, fits: end === text.length, end };
}

export function layoutSeaBody(body: string, byteBudget?: number) {
  return layoutSeaText(body, true, byteBudget);
}

/** Keep the name on its own row and preserve explicit body line breaks. */
export function layoutSeaDialogue(name: string, body: string) {
  const layout = layoutSeaBody(body);
  const heading = `${seaDisplayName(name)}：`;
  const nameLayout = layoutSeaText(`${heading}\n`, false);
  return [...nameLayout.placements, ...layout.placements.map((glyph) => ({ ...glyph, row: glyph.row + 1 }))];
}

export function seaBodyByteBudget(fields: Omit<SeaSubmission, "clientMessageId" | "body">) {
  const envelope = { ...fields, clientMessageId: "00000000-0000-0000-0000-000000000000", body: "" };
  return SEA_MESSAGE_REQUEST_BYTES - utf8.encode(JSON.stringify(envelope)).length;
}

export function limitSeaBodyInput(body: string, caret: number, previous: string, byteBudget: number) {
  const layout = layoutSeaBody(body, byteBudget);
  if (layout.fits) return body;
  if (body.length <= byteBudget && utf8.encode(JSON.stringify(body)).length - 2 <= byteBudget) {
    const prefix = body.slice(0, caret);
    const lineStart = prefix.lastIndexOf("\n") + 1;
    let start = lineStart;
    for (const token of seaBodyTokens(prefix.slice(lineStart))) {
      if (token.length === 2 && pendingParameter.test(prefix.slice(start))) {
        // A two-character prefix here has no closing bracket at the caret.
        // Allow finishing it even when its literal parameters would overflow.
        const completed = body.slice(0, start) + "\\C[0]" + body.slice(caret);
        if (layoutSeaBody(completed, byteBudget).fits) return body;
        break;
      }
      start += token.length;
    }
  }
  return caret === body.length ? body.slice(0, layout.end) : previous;
}

const bitmaps = new Map<string, Promise<HTMLImageElement>>();
const fontBitmaps = new Map<string, Map<string, HTMLCanvasElement>>();
let fontMask: HTMLCanvasElement | undefined;
// Each 12px text mask in the RTP 2000 System/システム.png is uniform across a row.
const textPalettes = [
  [0xF0FAFF, 0xF0FAFF, 0xD5ECFD, 0xD5ECFD, 0xBBDEFC, 0xBBDEFC, 0xA1D0FB, 0xA1D0FB, 0x87C3FA, 0x6CB5F8, 0x52A7F7, 0x3899F6],
  [0x82AAFF, 0x82AAFF, 0x7399EE, 0x7399EE, 0x6489DE, 0x6489DE, 0x5579CE, 0x5579CE, 0x4669BE, 0x3758AD, 0x28489D, 0x19388D],
  [0xFFEBCD, 0xFFEBCD, 0xFBDAB5, 0xFBDAB5, 0xF7CA9D, 0xF7CA9D, 0xF3BA85, 0xF3BA85, 0xF0AA6E, 0xEC9956, 0xE8893E, 0xE47926],
  [0xC9C9CD, 0xC9C9CD, 0xB0B0B4, 0xB0B0B4, 0x98989B, 0x98989B, 0x7F7F82, 0x7F7F82, 0x676769, 0x4E4E50, 0x363637, 0x1D1D1E],
  [0xFFFD87, 0xFFFD87, 0xFBF278, 0xFBF278, 0xF7E769, 0xF7E769, 0xF3DD5A, 0xF3DD5A, 0xF0D24B, 0xECC73C, 0xE8BD2D, 0xE4B21E],
  [0xE1BEBE, 0xE1BEBE, 0xDAADAD, 0xDAADAD, 0xD49D9D, 0xD49D9D, 0xCE8D8D, 0xCE8D8D, 0xC87D7D, 0xC16C6C, 0xBB5C5C, 0xB54C4C],
  [0xEBE2FF, 0xEBE2FF, 0xDACFFA, 0xDACFFA, 0xCABCF5, 0xCABCF5, 0xBAA9F0, 0xBAA9F0, 0xAA96EB, 0x9983E6, 0x8970E1, 0x795DDC],
  [0xFFE6FF, 0xFFE6FF, 0xF6CEF6, 0xF6CEF6, 0xEDB6ED, 0xEDB6ED, 0xE49EE4, 0xE49EE4, 0xDC87DC, 0xD36FD3, 0xCA57CA, 0xC13FC1],
  [0xFFE6A6, 0xFFE6A6, 0xFDD993, 0xFDD993, 0xFCCD80, 0xFCCD80, 0xFBC06D, 0xFBC06D, 0xFAB45A, 0xF8A747, 0xF79B34, 0xF68E21],
  [0xD3FFBA, 0xD3FFBA, 0xC2F7A4, 0xC2F7A4, 0xB2F08F, 0xB2F08F, 0xA2E87A, 0xA2E87A, 0x92E165, 0x81D94F, 0x71D23A, 0x61CA25],
  [0x9BDCFF, 0x9BDCFF, 0x88CAFA, 0x88CAFA, 0x75B9F5, 0x75B9F5, 0x62A7F0, 0x62A7F0, 0x5096EB, 0x3D84E6, 0x2A73E1, 0x1761DC],
  [0xFFEBEB, 0xFFEBEB, 0xF8D4D4, 0xF8D4D4, 0xF2BEBE, 0xF2BEBE, 0xECA7A7, 0xECA7A7, 0xE69191, 0xDF7A7A, 0xD96464, 0xD34D4D],
  [0xE1FFA0, 0xE1FFA0, 0xD9F78D, 0xD9F78D, 0xD2F07A, 0xD2F07A, 0xCAE867, 0xCAE867, 0xC3E155, 0xBBD942, 0xB4D22F, 0xACCA1C],
  [0xEBC3FF, 0xEBC3FF, 0xE3B2FA, 0xE3B2FA, 0xDCA2F5, 0xDCA2F5, 0xD492F0, 0xD492F0, 0xCD82EB, 0xC571E6, 0xBE61E1, 0xB651DC],
  [0xFFD04B, 0xFFD04B, 0xFCC743, 0xFCC743, 0xFABE3C, 0xFABE3C, 0xF8B535, 0xF8B535, 0xF6AC2E, 0xF3A326, 0xF19A1F, 0xEF9118],
  [0xDCFFF0, 0xDCFFF0, 0xC3F6DA, 0xC3F6DA, 0xAAEDC5, 0xAAEDC5, 0x91E4B0, 0x91E4B0, 0x78DC9B, 0x5FD385, 0x46CA70, 0x2DC15B],
  [0xD2B4EB, 0xD2B4EB, 0xC0A2D9, 0xC0A2D9, 0xAF91C8, 0xAF91C8, 0x9D7FB6, 0x9D7FB6, 0x8C6EA5, 0x7A5C93, 0x694B82, 0x573970],
  [0x8BB4CF, 0x8BB4CF, 0x7CA5C0, 0x7CA5C0, 0x6D96B1, 0x6D96B1, 0x5E87A2, 0x5E87A2, 0x4F7893, 0x406984, 0x315A75, 0x224B66],
  [0x6FC692, 0x6FC692, 0x61B884, 0x61B884, 0x53AA76, 0x53AA76, 0x459C68, 0x459C68, 0x388F5B, 0x2A814D, 0x1C733F, 0x0E6531],
  [0xEBB469, 0xEBB469, 0xD9A25D, 0xD9A25D, 0xC89152, 0xC89152, 0xB67F47, 0xB67F47, 0xA56E3C, 0x935C30, 0x824B25, 0x70391A],
];

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
  for (const placement of placements) {
    if (placement.character === "\n") continue;
    const key = placement.color ? `${placement.color}:${placement.character}` : placement.character;
    let bitmap = rendered.get(key);
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
      const colors = textPalettes[placement.color ?? 0];
      for (let y = 0; y < 12; y++) {
        const color = colors[y];
        const rgba = [color >> 16, color >> 8 & 0xFF, color & 0xFF, 255];
        for (let x = 0; x < placement.width; x++) {
          if (mask[(y * 14 + x) * 4 + 3] >= 128) image.data.set(rgba, (y * 14 + x) * 4);
        }
      }
      pixels.putImageData(image, 0, 0);
      rendered.set(key, bitmap);
    }
    context.drawImage(bitmap, 0, 0, placement.width + 1, 13,
      seaTextLeft(side) + placement.x, SEA_TEXT_TOP + placement.row * SEA_LINE_HEIGHT, placement.width + 1, 13);
  }
}
