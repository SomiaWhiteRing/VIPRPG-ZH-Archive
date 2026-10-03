"""Import the RTP and EasyRPG bitmap resources used by the Eternal Sea preview.

python scripts/import-eternal-sea-assets.py --rtp-collection ../RPGRewriter-Ownuse/modules/RTPCollection/rtp-content.zip --player ../Player
"""
import argparse
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public/assets/eternal-sea"
GLYPHS = ROOT / "lib/ui/eternal-sea-glyphs.json"


def bitmap_font(path):
    rows = re.findall(r"\{\s*(\d+),\s*(true|false),\s*\{([^}]+)\}\s*\}", path.read_text(encoding="utf-8"))
    return {int(code): (12 if full == "true" else 6, [int(n.strip()) for n in bits.split(",") if n.strip()]) for code, full, bits in rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rtp-collection", type=Path, required=True)
    parser.add_argument("--player", type=Path, required=True)
    args = parser.parse_args()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / "lib/archive/rtp-catalog.json").read_text(encoding="utf-8"))
    provenance = {"rtpPack": "2000", "fontEncoding": "CP936", "windowStretch": True,
                  "seaTile": {"id": 0, "size": 16, "sequence": [0, 1, 2, 1], "framesPerStep": 24}, "resources": {}}
    with zipfile.ZipFile(args.rtp_collection) as archive:
        def resource(name):
            row = next(r for r in catalog["entries"] if r[0] == name and "2000" in r[3])
            data = archive.read("blobs/" + row[2])
            if len(data) != row[1] or hashlib.sha256(data).hexdigest() != row[2]:
                raise ValueError("RTP fingerprint mismatch: " + name)
            provenance["resources"][name] = row[2]
            return Image.open(io.BytesIO(data))

        chipset = resource("chipset/基本.png")
        # GenerateAutotileAB for tile ID 0: no A quarters, B row 4.
        # The default slow animation uses 24 engine frames per step, 0,1,2,1.
        water = [chipset.crop((phase * 16, 64, phase * 16 + 16, 80)) for phase in range(3)]
        water[0].save(PUBLIC / "ocean.png", optimize=True)
        water[0].save(PUBLIC / "ocean.gif", save_all=True, append_images=[water[1], water[2], water[1]], duration=400, loop=0, optimize=False)
        system = resource("system/システム.png")
        faces = resource("faceset/主人公1.png")

        def transparent(image):
            rgba = image.convert("RGBA")
            if image.mode == "P":
                rgba.putalpha(image.point(lambda value: 0 if value == 0 else 255, mode="L"))
            return rgba

        skin = transparent(system)
        # Window::RefreshBackground / RefreshFrame: stretch the 32x32 background,
        # tile the four 16px edge regions, then draw the four 8px corners.
        window = system.convert("RGBA").crop((0, 0, 32, 32)).resize((320, 80), Image.Resampling.NEAREST)
        for x in range(8, 312, 16):
            width = min(16, 312 - x)
            window.alpha_composite(skin.crop((40, 0, 40 + width, 8)), (x, 0))
            window.alpha_composite(skin.crop((40, 24, 40 + width, 32)), (x, 72))
        for y in range(8, 72, 16):
            height = min(16, 72 - y)
            window.alpha_composite(skin.crop((32, 8, 40, 8 + height)), (0, y))
            window.alpha_composite(skin.crop((56, 8, 64, 8 + height)), (312, y))
        for sx, sy, dx, dy in [(32, 0, 0, 0), (56, 0, 312, 0), (32, 24, 0, 72), (56, 24, 312, 72)]:
            window.alpha_composite(skin.crop((sx, sy, sx + 8, sy + 8)), (dx, dy))
        window.save(PUBLIC / "window.png", optimize=True)
        faces = transparent(faces)
        faces.save(PUBLIC / "faces.png", optimize=True)

    generated = args.player / "src/generated"
    font = bitmap_font(generated / "shinonome_gothic.h")
    # find_gothic_glyph: CP936 uses WenQuanYi first, then Shinonome Gothic.
    font.update(bitmap_font(generated / "bitmapfont_wqy.h"))
    font[65533] = (12, [96, 240, 504, 924, 1902, 3967, 4031, 1982, 1020, 440, 240, 96])
    ordered = sorted(font.items())
    atlas = Image.new("RGBA", (128 * 14, ((len(ordered) + 127) // 128) * 14))
    palette = system.convert("RGBA")
    pixels = atlas.load()
    metadata = []
    for index, (code, (width, bits)) in enumerate(ordered):
        if len(bits) != 12:
            raise ValueError("Unexpected bitmap glyph height")
        metadata.append([code, width])
        ax, ay = (index % 128) * 14, (index // 128) * 14
        # Font::RenderImpl: the shadow starts at System(16,32), the default
        # 12px text color starts at System(2,52), with a (1,1) shadow offset.
        for y, row in enumerate(bits):
            for x in range(width):
                if row & (1 << x):
                    pixels[ax + x + 1, ay + y + 1] = palette.getpixel((16 + x, 32 + y))
        for y, row in enumerate(bits):
            for x in range(width):
                if row & (1 << x):
                    pixels[ax + x, ay + y] = palette.getpixel((2 + x, 52 + y))
    atlas.save(PUBLIC / "font.png", optimize=True)
    GLYPHS.write_text(json.dumps(metadata, separators=(",", ":")) + "\n", encoding="utf-8")
    for name in ["shinonome_gothic.h", "bitmapfont_wqy.h"]:
        provenance["resources"][name] = hashlib.sha256((generated / name).read_bytes()).hexdigest()
    notices = "EasyRPG CP936 bitmap font resources\n\nSources: https://github.com/EasyRPG/Player/tree/master/resources\n\n"
    for name in ["wenquanyi/README", "wenquanyi/doc/AUTHORS", "wenquanyi/doc/COPYING", "shinonome/AUTHORS"]:
        notices += f"\n--- {name} ---\n" + (args.player / "resources" / name).read_text(encoding="utf-8", errors="replace")
    notices = "\n".join(line.rstrip() for line in notices.splitlines()) + "\n"
    (PUBLIC / "font-notices.txt").write_text(notices, encoding="utf-8")
    (PUBLIC / "sources.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported sea autotile, window, faces and {len(metadata):,} bitmap glyphs")


if __name__ == "__main__":
    main()
