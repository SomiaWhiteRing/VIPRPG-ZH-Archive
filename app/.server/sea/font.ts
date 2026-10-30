import { zlibSync, unzlibSync } from "fflate";
import tables from "./font-template.json";
import glyphs from "@/lib/ui/eternal-sea-glyphs.json";
import { layoutSeaDialogue } from "@/lib/ui/eternal-sea";
import type { SeaFont, SeaMessage } from "@/lib/dto/sea";
import { base64UrlDecodeBytes } from "@/app/.server/crypto/encoding";

const DAY = 86400000;
const OFFSET = 5 * 3600000; // Hong Kong 03:00 = UTC 19:00 on the previous day.
const FIRST_CHARACTER = 0x3400;
export type SeaFontState = { day: number; id: string; order: Uint16Array };
export type SeaOriginalMessage = Omit<SeaMessage, "glyphs">;

export function seaFontDay(now: number) { return Math.floor((now + OFFSET) / DAY); }
export function seaFontDeadline(day: number) { return (day + 1) * DAY - OFFSET; }

export function createSeaFontState(day: number): SeaFontState {
  const order = Uint16Array.from(glyphs, (_, index) => index);
  const random = crypto.getRandomValues(new Uint16Array(order.length));
  for (let i = order.length - 1; i > 0; i--) {
    const other = random[i] % (i + 1);
    [order[i], order[other]] = [order[other], order[i]];
  }
  for (let i = 0; i < order.length; i++) {
    if (glyphs[order[i]][0] !== FIRST_CHARACTER + i) continue;
    const other = (i + 1) % order.length;
    [order[i], order[other]] = [order[other], order[i]];
  }
  return { day, id: crypto.randomUUID(), order };
}

function checksum(bytes: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + ((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16)
      | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0;
  }
  return sum;
}

function buildFont(order: Uint16Array) {
  // Two Unicode records share a BMP format-4 cmap: one contiguous shuffled range.
  const cmap = new Uint8Array(20 + 32 + order.length * 2);
  const cm = new DataView(cmap.buffer);
  cm.setUint16(2, 2);
  cm.setUint16(6, 3); cm.setUint32(8, 20);
  cm.setUint16(12, 3); cm.setUint16(14, 1); cm.setUint32(16, 20);
  cm.setUint16(20, 4); cm.setUint16(22, cmap.length - 20);
  cm.setUint16(26, 4); cm.setUint16(28, 4); cm.setUint16(30, 1);
  cm.setUint16(34, FIRST_CHARACTER + order.length - 1); cm.setUint16(36, 0xFFFF);
  cm.setUint16(40, FIRST_CHARACTER); cm.setUint16(42, 0xFFFF);
  cm.setUint16(46, 1); cm.setUint16(48, 4);
  for (let i = 0; i < order.length; i++) cm.setUint16(52 + i * 2, order[i] + 1);
  const compressedCmap = zlibSync(cmap);
  const entries = [...tables.map(table => ({ ...table, bytes: base64UrlDecodeBytes(table.data) })),
    { tag: "cmap", length: cmap.length, checksum: checksum(cmap), bytes: compressedCmap.length < cmap.length ? compressedCmap : cmap }]
    .sort((a, b) => a.tag < b.tag ? -1 : 1);
  const sfntSize = 12 + entries.length * 16 + entries.reduce((sum, table) => sum + ((table.length + 3) & ~3), 0);
  const directory = new Uint8Array(12 + entries.length * 16);
  const sf = new DataView(directory.buffer);
  const power = Math.floor(Math.log2(entries.length));
  sf.setUint32(0, 0x10000); sf.setUint16(4, entries.length);
  sf.setUint16(6, 16 * 2 ** power); sf.setUint16(8, power);
  sf.setUint16(10, entries.length * 16 - 16 * 2 ** power);
  let sfntOffset = directory.length;
  for (const [i, table] of entries.entries()) {
    for (let n = 0; n < 4; n++) directory[12 + i * 16 + n] = table.tag.charCodeAt(n);
    sf.setUint32(16 + i * 16, table.checksum);
    sf.setUint32(20 + i * 16, sfntOffset); sf.setUint32(24 + i * 16, table.length);
    sfntOffset += (table.length + 3) & ~3;
  }
  const adjustment = (0xB1B0AFBA - checksum(directory) - entries.reduce((sum, table) => sum + table.checksum, 0)) >>> 0;
  const head = entries.find(table => table.tag === "head")!;
  const headBytes = head.bytes.length < head.length ? unzlibSync(head.bytes) : head.bytes.slice();
  new DataView(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength).setUint32(8, adjustment);
  const compressedHead = zlibSync(headBytes);
  head.bytes = compressedHead.length < head.length ? compressedHead : headBytes;
  const font = new Uint8Array(44 + entries.length * 20 + entries.reduce((sum, table) => sum + ((table.bytes.length + 3) & ~3), 0));
  const view = new DataView(font.buffer);
  view.setUint32(0, 0x774F4646); view.setUint32(4, 0x10000); view.setUint32(8, font.length);
  view.setUint16(12, entries.length); view.setUint32(16, sfntSize); view.setUint16(20, 1);
  let offset = 44 + entries.length * 20;
  for (const [i, table] of entries.entries()) {
    const at = 44 + i * 20;
    for (let n = 0; n < 4; n++) font[at + n] = table.tag.charCodeAt(n);
    view.setUint32(at + 4, offset); view.setUint32(at + 8, table.bytes.length);
    view.setUint32(at + 12, table.length); view.setUint32(at + 16, table.checksum);
    font.set(table.bytes, offset);
    offset += (table.bytes.length + 3) & ~3;
  }
  return font.buffer;
}

export function seaFontCodec(state: SeaFontState) {
  const characters = new Map<number, string>();
  for (const [index, original] of state.order.entries()) characters.set(glyphs[original][0], String.fromCodePoint(FIRST_CHARACTER + index));
  const encode = (text: string) => Array.from(text, character => character === "\n" ? character
    : characters.get(character.codePointAt(0)!) ?? characters.get(65533)!).join("");
  const font: SeaFont = { id: state.id, url: `/api/sea/fonts/${state.id}`, expiresAt: seaFontDeadline(state.day) };
  let bytes: ArrayBuffer | undefined;
  return {
    font,
    bytes: () => bytes ??= buildFont(state.order),
    message(message: SeaOriginalMessage): SeaMessage {
      return { ...message, name: encode(message.name), body: encode(message.body),
        glyphs: layoutSeaDialogue(message.name, message.body).placements.map(glyph => ({ ...glyph, character: encode(glyph.character) })) };
    },
  };
}
