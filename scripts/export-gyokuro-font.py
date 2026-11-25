"""Export a fixed, versioned copy of the Eternal Sea bitmap glyphs for Gyokuro."""
import argparse
import gzip
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New versioned .bin.gz path (will not overwrite)")
    args = parser.parse_args()
    metadata = json.loads((ROOT / "lib/ui/eternal-sea-glyphs.json").read_text(encoding="utf-8"))
    atlas = Image.open(ROOT / "public/assets/eternal-sea/font.png").convert("RGBA")
    pixels = atlas.load()
    with args.output.open("xb") as output, gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0) as font:
        for index, (code, width, *advance) in enumerate(metadata):
            x, y = (index % 128) * 14, (index // 128) * 14
            rows = []
            for row in range(12):
                mask = 0
                for col in range(width):
                    r, g, b, alpha = pixels[x + col, y + row]
                    if alpha and (r, g, b) != (29, 29, 30):
                        mask |= 1 << col
                rows.append(mask)
            # Code point, ink width, advance and 12 left-to-right bitmap rows.
            font.write(struct.pack("<IBB12H", code, width, advance[0] if advance else width, *rows))
    print(f"Exported {len(metadata):,} bitmap glyphs: {args.output}")


if __name__ == "__main__":
    main()
