import type { SeaFont } from "@/lib/dto/sea";

const fonts = new Map<string, { face: FontFace; loading: Promise<FontFace> }>();
export function seaFontFamily(font: SeaFont) { return `Sea-${font.id}`; }

export function loadSeaFont(font: SeaFont) {
  let entry = fonts.get(font.id);
  if (!entry) {
    const face = new FontFace(seaFontFamily(font), `url("${font.url}")`);
    const loading = face.load().then(loaded => {
      document.fonts.add(loaded);
      for (const [id, previous] of fonts) {
        if (fonts.size <= 2) break;
        if (id === font.id) continue;
        document.fonts.delete(previous.face);
        fonts.delete(id);
      }
      return loaded;
    }).catch(error => { fonts.delete(font.id); throw error; });
    entry = { face, loading };
    fonts.set(font.id, entry);
  }
  return entry.loading;
}
