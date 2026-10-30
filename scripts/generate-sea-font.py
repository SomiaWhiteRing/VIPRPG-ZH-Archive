"""Generate private compressed font tables from the existing sea bitmap atlas.

Requires Pillow and fontTools. No character map is included in the template.
python scripts/generate-sea-font.py
"""
import base64
import io
import json
import struct
import zlib
from pathlib import Path

from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parents[1]


def main():
    metadata = json.loads((ROOT / "lib/ui/eternal-sea-glyphs.json").read_text(encoding="utf-8"))
    atlas = Image.open(ROOT / "public/assets/eternal-sea/font.png").convert("RGBA")
    names = [".notdef"] + [f"g{i}" for i in range(len(metadata))]
    outlines = {".notdef": TTGlyphPen(None).glyph()}
    advances = {".notdef": 1200}
    for index, (_, width) in enumerate(metadata):
        pen = TTGlyphPen(None)
        ax, ay = index % 128 * 14, index // 128 * 14
        for y in range(12):
            pixels = [atlas.getpixel((ax + x, ay + y)) for x in range(width)]
            # The atlas uses a uniform dark shadow behind its colored foreground.
            foreground = [p[3] != 0 and p[:3] != (29, 29, 30) for p in pixels]
            x = 0
            while x < width:
                if not foreground[x]:
                    x += 1
                    continue
                start = x
                while x < width and foreground[x]:
                    x += 1
                pen.moveTo((start * 100, (11 - y) * 100))
                pen.lineTo((start * 100, (12 - y) * 100))
                pen.lineTo((x * 100, (12 - y) * 100))
                pen.lineTo((x * 100, (11 - y) * 100))
                pen.closePath()
        name = names[index + 1]
        outlines[name] = pen.glyph()
        advances[name] = width * 100

    builder = FontBuilder(1200, isTTF=True)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({code: names[i + 1] for i, (code, _) in enumerate(metadata)})
    builder.setupGlyf(outlines)
    builder.setupHorizontalMetrics({name: (advance, getattr(outlines[name], "xMin", 0)) for name, advance in advances.items()})
    builder.setupHorizontalHeader(ascent=1200, descent=0)
    builder.setupNameTable({
        "familyName": "Eternal Sea", "styleName": "Regular", "fullName": "Eternal Sea",
        "psName": "EternalSea", "uniqueFontIdentifier": "EternalSea-1", "version": "Version 1.0",
        "copyright": "WenQuanYi / Shinonome; see /assets/eternal-sea/font-notices.txt",
    })
    builder.setupOS2(sTypoAscender=1200, sTypoDescender=0, sTypoLineGap=0,
                     usWinAscent=1200, usWinDescent=0, fsType=0)
    builder.setupPost(keepGlyphNames=False)
    output = io.BytesIO()
    builder.save(output)
    raw = output.getvalue()
    tables = []
    for i in range(struct.unpack_from(">H", raw, 4)[0]):
        tag, _, offset, length = struct.unpack_from(">4sIII", raw, 12 + i * 16)
        if tag == b"cmap":
            continue
        data = bytearray(raw[offset:offset + length])
        if tag == b"head":
            data[8:12] = bytes(4)
        padded = data + bytes(-len(data) % 4)
        checksum = sum(struct.unpack(f">{len(padded) // 4}I", padded)) & 0xFFFFFFFF
        compressed = zlib.compress(data, level=9)
        payload = compressed if len(compressed) < length else data
        tables.append({"tag": tag.decode("ascii"), "checksum": checksum, "length": length,
                       "data": base64.b64encode(payload).decode("ascii")})
    target = ROOT / "app/.server/sea/font-template.json"
    target.write_text(json.dumps(tables, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(metadata):,} glyphs, {len(tables)} compressed tables ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
