"""Compare game-referenced face cells / character blocks with current library.

Run after extract-character-history.py. Only produces local review artifacts.
Pillow is required; no UI or model translation is used.
"""
import argparse
import collections
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

from importlib.util import module_from_spec, spec_from_file_location

SPEC = spec_from_file_location("history", Path(__file__).with_name("extract-character-history.py"))
history = module_from_spec(SPEC)
sys.dont_write_bytecode = True
SPEC.loader.exec_module(history)


def rgba(image, indexed_transparency=False):
    converted = image.convert("RGBA")
    if indexed_transparency and image.mode == "P":
        converted.putalpha(image.point([0] + [255] * 255, mode="L"))
    # Hidden RGB values do not change a rendered sprite.
    converted.paste((0, 0, 0, 0), (0, 0, converted.width, converted.height),
                    converted.getchannel("A").point([255] + [0] * 255))
    return converted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=history.ROOT / "output/character-history-2005-2025")
    args = parser.parse_args()
    out = args.output.resolve()
    load = lambda name: json.loads((out / name).read_text("utf-8"))
    assets = {a["path"]: a for a in load("assets.json")}
    events = load("events.json")
    cells = {}
    for e in events:
        for ref in [e["sprite"], *e["imageReferences"]]:
            if not ref or ref["folder"] not in {"FaceSet", "CharSet"}:
                continue
            for path in ref["assetPaths"]:
                index = ref["index"]
                cell_key = f"{path}#{index}"
                if cell_key not in cells:
                    a = assets[path]
                    if ref["folder"] == "FaceSet":
                        x, y, width, height = index % 4 * 48, index // 4 * 48, 48, 48
                    else:
                        x, y, width, height = index % 4 * 72, index // 4 * 128, 72, 128
                    if min(x, y) < 0 or x + width > a["width"] or y + height > a["height"]:
                        raise ValueError(f"Invalid referenced cell {cell_key}")
                    with Image.open(out / a["file"]) as im:
                        raw = rgba(im).crop((x, y, x + width, y + height))
                        rendered = rgba(im, True).crop((x, y, x + width, y + height))
                    cells[cell_key] = {"key": cell_key, "path": path, "kind": a["kind"], "index": index,
                        "rectangle": [x, y, width, height], "rawPixelSha256": history.pixel_hash(raw),
                        "indexZeroPixelSha256": history.pixel_hash(rendered), "wholeImageNovelty": a["novelty"],
                        "events": [], "libraryMatches": []}
                cells[cell_key]["events"].append({"locator": e["locator"], "title": e["title"],
                    "matchStatus": e["matchStatus"], "candidateCharacterIds": e["candidateCharacterIds"],
                    "role": ref["role"], "commandIndex": ref.get("commandIndex"),
                    "isInitialFace": ref["folder"] == "FaceSet" and e["initialFace"] is not None and path in e["initialFace"]["assetPaths"] and index == e["initialFace"]["index"]})
    wanted = collections.defaultdict(list)
    for c in cells.values():
        wanted[(c["kind"], c["rawPixelSha256"])].append((c, "rgba"))
        if c["indexZeroPixelSha256"] != c["rawPixelSha256"]:
            wanted[(c["kind"], c["indexZeroPixelSha256"])].append((c, "palette_index_zero_transparent"))
    errors, scanned = [], collections.Counter()
    for folder, field in [("character-face-sheets", "sheets"), ("character-materials", "materials")]:
        base = history.ROOT / "data" / folder
        items = json.loads((base / "manifest.json").read_text("utf-8"))[field]
        for item in items:
            kind = item.get("kind", "faceset")
            if kind not in {"faceset", "charset"}:
                continue
            path = base / item["file"]
            try:
                with Image.open(path) as im:
                    if kind == "faceset" and im.width % 48 == 0 and im.height % 48 == 0:
                        width, height = 48, 48
                    elif kind == "charset" and im.size == (288, 256):
                        width, height = 72, 128
                    else:
                        continue
                    image = rgba(im)
                    interpreted = rgba(im, True)
                    for y in range(0, im.height, height):
                        for x in range(0, im.width, width):
                            scanned[kind] += 1
                            signatures = {history.pixel_hash(image.crop((x, y, x + width, y + height))): "rgba"}
                            alternate = history.pixel_hash(interpreted.crop((x, y, x + width, y + height)))
                            signatures.setdefault(alternate, "palette_index_zero_transparent")
                            for signature, library_mode in signatures.items():
                                for cell, source_mode in wanted.get((kind, signature), []):
                                    cell["libraryMatches"].append({"sha256": item["sha256"], "file": path.relative_to(history.ROOT).as_posix(),
                                        "rectangle": [x, y, width, height], "names": item["boundOriginalNames"],
                                        "sourceMode": source_mode, "libraryMode": library_mode})
            except (OSError, ValueError) as error:
                errors.append({"file": str(path), "error": str(error)})
        print(f"Scanned {folder}: {dict(scanned)} cells", flush=True)
    # A full-image match also proves the identical rectangle exists, even when
    # the repository classifies the sheet as 'other' instead of 'charset'.
    for cell in cells.values():
        if cell["libraryMatches"]:
            continue
        asset = assets[cell["path"]]
        for match in asset["existingByteMatches"] or asset["existingPixelMatches"]:
            cell["libraryMatches"].append({**match, "rectangle": cell["rectangle"],
                "sourceMode": "whole_image_same_rectangle", "libraryMode": "whole_image_same_rectangle"})
    records = list(cells.values())
    history.save(out / "cells.json", records)
    summary = {"referencedCells": len(records), "libraryCellsScanned": dict(scanned), "decodeErrors": errors,
        "byKind": {kind: {"referencedCells": sum(c["kind"] == kind for c in records),
            "foundInLibrary": sum(c["kind"] == kind and bool(c["libraryMatches"]) for c in records),
            "notFoundInLibrary": sum(c["kind"] == kind and not c["libraryMatches"] for c in records),
            "newWholeImageButCellFound": sum(c["kind"] == kind and c["wholeImageNovelty"] == "not_found_as_whole_image" and bool(c["libraryMatches"]) for c in records)} for kind in ["faceset", "charset"]},
        "note": "Exact rendered cells only; this does not prove artwork novelty, ownership or character identity. Charset comparison is limited to standard 288x256 sheets. Palette index zero interpretation is recorded per match."}
    history.save(out / "cell-summary.json", summary)
    shortlist = []
    for c in records:
        if c["libraryMatches"]:
            continue
        direct = [e for e in c["events"] if e["matchStatus"] == "exact_name_or_alias" and (e["role"] == "event_sprite" or e["isInitialFace"])]
        if direct:
            shortlist.append({**c, "reviewRequired": True, "directExactNameEvidence": direct})
    summary["priorityCandidates"] = {"cells": len(shortlist),
        "byKind": dict(collections.Counter(c["kind"] for c in shortlist)),
        "characterIds": sorted({cid for c in shortlist for e in c["directExactNameEvidence"] for cid in e["candidateCharacterIds"]})}
    history.save(out / "cell-summary.json", summary)
    history.save(out / "supplement-cell-candidates.json", shortlist)
    history.csv_file(out / "supplement-cell-candidates.csv", shortlist, ["key", "kind", "index", "rectangle", "wholeImageNovelty", "directExactNameEvidence"])

    # A static evidence contact sheet from game-defined cell coordinates.
    # This is not a screenshot, gameplay test, or edited source image.
    selected = []
    seen_titles = set()
    for c in shortlist:
        e = c["directExactNameEvidence"][0]
        if c["kind"] == "faceset" and e["title"] not in seen_titles:
            selected.append(c)
            seen_titles.add(e["title"])
        if len(selected) == 12:
            break
    font_path = Path("C:/Windows/Fonts/meiryo.ttc")
    font = ImageFont.truetype(str(font_path), 16) if font_path.exists() else ImageFont.load_default()
    sheet = Image.new("RGB", (1000, max(1, (len(selected) + 3) // 4) * 170), "#eeeeee")
    draw = ImageDraw.Draw(sheet)
    sample_index = []
    for i, c in enumerate(selected):
        a = assets[c["path"]]
        x, y, width, height = c["rectangle"]
        with Image.open(out / a["file"]) as im:
            tile = rgba(im, True).crop((x, y, x + width, y + height)).resize((96, 96), Image.Resampling.NEAREST)
        ox, oy = i % 4 * 250 + 12, i // 4 * 170 + 8
        sheet.paste(tile, (ox, oy), tile)
        e = c["directExactNameEvidence"][0]
        draw.text((ox, oy + 100), e["title"], font=font, fill="black")
        draw.text((ox, oy + 123), e["locator"].replace("/P0001", ""), font=font, fill="black")
        sample_index.append({"number": i + 1, "title": e["title"], "locator": e["locator"], "cell": c["key"], "characterIds": e["candidateCharacterIds"]})
    sheet.save(out / "sample-faces.png")
    history.save(out / "sample-faces.json", sample_index)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
