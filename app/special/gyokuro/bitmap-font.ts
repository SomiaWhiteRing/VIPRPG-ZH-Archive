import { gunzipSync } from "fflate";

type Glyph = { advance: number; width: number; rows: number[] };
export type BitmapFont = (char: string) => Glyph;

export function parseBitmapFont(bytes: Uint8Array): BitmapFont {
  // scripts/export-gyokuro-font.py writes little-endian <IBB12H records.
  const recordSize = 30;
  if (bytes.byteLength % recordSize) throw new Error("Invalid Gyokuro bitmap font");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets = new Map<number, number>();
  for (let start = 0; start < view.byteLength; start += recordSize) {
    offsets.set(view.getUint32(start, true), start);
  }
  const fallback = offsets.get(0xfffd);
  if (fallback === undefined) throw new Error("Missing replacement glyph");
  const cache = new Map<number, Glyph>();
  return char => {
    const offset = offsets.get(char.codePointAt(0) ?? 0xfffd) ?? fallback;
    let glyph = cache.get(offset);
    if (!glyph) {
      glyph = {
        width: view.getUint8(offset + 4),
        advance: view.getUint8(offset + 5),
        rows: Array.from({ length: 12 }, (_, i) => view.getUint16(offset + 6 + i * 2, true)),
      };
      cache.set(offset, glyph);
    }
    return glyph;
  };
}

let fontRequest: Promise<BitmapFont> | undefined;

export function loadGyokuroFont() {
  return fontRequest ??= fetch("/assets/gyokuro-stats/eternal-sea-v1.bin.gz", { cache: "force-cache" })
    .then(async response => {
      if (!response.ok) throw new Error("Gyokuro bitmap font request failed");
      return parseBitmapFont(gunzipSync(new Uint8Array(await response.arrayBuffer())));
    })
    .catch(error => {
      fontRequest = undefined;
      throw error;
    });
}
