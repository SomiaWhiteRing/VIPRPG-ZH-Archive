"""Extract a local RPG2000/2003 history game using EasyRPG LCF2XML.

Produces an evidence corpus, not an import manifest. No game/DB/library writes.
Requires Python 3.11+, Pillow, and the official EasyRPG lcf2xml executable.
"""

import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGE_EXTENSIONS = {".png", ".bmp", ".gif", ".jpg", ".jpeg"}
KINDS = {"FaceSet": "faceset", "CharSet": "charset", "Monster": "monster", "Picture": "other", "Battle": "other"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def key(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip().lower()


def value(element, name):
    return element.findtext(name) or ""


def number(element, name):
    return int(value(element, name) or 0)


def commands(element):
    return [{"index": i, "code": number(c, "code"), "indent": number(c, "indent"),
             "string": value(c, "string"), "parameters": [int(v) for v in value(c, "parameters").split()]}
            for i, c in enumerate(element.findall("event_commands/EventCommand"))]


def pixel_hash(image):
    # Exact decoded RGBA, including transparent RGB. No resizing or fuzzy matching.
    rgba = image.convert("RGBA")
    return hashlib.sha256(f"{rgba.width}x{rgba.height}:".encode() + rgba.tobytes()).hexdigest()


def csv_file(path, rows, fields):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items() if k in fields})


def snapshot(db_path):
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")
        tables = {
            "characters": "SELECT id,primary_name,original_name,description,extra_json FROM characters ORDER BY id",
            "aliases": "SELECT character_id,name,language FROM character_aliases ORDER BY character_id,name",
            "sources": "SELECT character_id,url,sort_order FROM character_sources ORDER BY character_id,sort_order",
            "memberships": "SELECT * FROM character_category_memberships ORDER BY category_id,character_id",
            "categories": "SELECT * FROM character_categories ORDER BY id",
            "faceBindings": "SELECT b.character_id,f.blob_sha256 FROM character_face_sheet_bindings b JOIN face_sheets f ON f.id=b.face_sheet_id",
            "materialBindings": "SELECT b.character_id,m.blob_sha256,m.kind FROM character_material_bindings b JOIN character_materials m ON m.id=b.material_id",
            "defaultPortraits": "SELECT character_id FROM character_default_portraits",
        }
        return {name: [dict(r) for r in db.execute(sql)] for name, sql in tables.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--lcf2xml", type=Path, required=True)
    parser.add_argument("--db", type=Path, required=True, help="Current local D1 SQLite file (read only)")
    parser.add_argument("--output", type=Path, default=ROOT / "output/character-history-2005-2025")
    args = parser.parse_args()
    game, tool, db_path, out = (p.resolve() for p in (args.game, args.lcf2xml, args.db, args.output))
    if out == game or game in out.parents or out in game.parents:
        raise ValueError("Output must be separate from the source game")
    out.mkdir(parents=True, exist_ok=True)
    xml_dir = out / "xml"
    xml_dir.mkdir(exist_ok=True)
    inputs = sorted(p for p in game.iterdir() if p.suffix.lower() in {".lmu", ".ldb", ".lmt"})
    expected = {".lmu": ".emu", ".ldb": ".edb", ".lmt": ".emt"}
    # LCF2XML writes next to inputs and older Windows builds need ASCII basenames.
    for p in inputs:
        shutil.copy2(p, xml_dir / p.name)
        (xml_dir / p.with_suffix(expected[p.suffix.lower()]).name).unlink(missing_ok=True)
    result = subprocess.run([str(tool), "--encoding", "932", *[p.name for p in inputs]], cwd=xml_dir, capture_output=True)
    save(out / "conversion.json", {"tool": str(tool), "toolSha256": sha(tool), "encoding": "932 (CP932)",
         "officialDownload": "https://ci.easyrpg.org/job/liblcf-win32/lastSuccessfulBuild/artifact/build/bin/lcf2xml.exe",
         "returnCode": result.returncode, "stdout": result.stdout.decode("utf-8", errors="replace"),
         "stderr": result.stderr.decode("utf-8", errors="replace")})
    result.check_returncode()
    for p in inputs:
        ET.parse(xml_dir / p.with_suffix(expected[p.suffix.lower()]).name)
    print(f"Converted and parsed {len(inputs)} LCF files", flush=True)
    inventory = [{"path": p.relative_to(game).as_posix(), "bytes": p.stat().st_size, "sha256": sha(p)}
                 for p in sorted(game.rglob("*")) if p.is_file()]
    save(out / "source-files.json", inventory)
    current = snapshot(db_path)
    save(out / "repository-snapshot.json", current)
    identities = collections.defaultdict(set)
    for c in current["characters"]:
        identities[key(c["original_name"])].add(c["id"])
    for a in current["aliases"]:
        if a["language"] == "ja":
            identities[key(a["name"])].add(a["character_id"])
    by_id = {c["id"]: c for c in current["characters"]}

    def match(title):
        ids = identities.get(key(title), set())
        if ids:
            return sorted(ids), "exact_name_or_alias" if len(ids) == 1 else "ambiguous"
        # Parenthetical names are suggestions only, never accepted bindings.
        parts = re.split(r"[（）()／/]", title)
        ids = set().union(*(identities.get(key(part), set()) for part in parts if part.strip()))
        return sorted(ids), "partial_heading_review" if ids else "unmatched"

    maps = {}
    for m in ET.parse(xml_dir / "RPG_RT.emt").findall(".//MapInfo"):
        mid = int(m.get("id"))
        maps[mid] = {"id": mid, "name": value(m, "name"), "parentId": number(m, "parent_map")}
    for m in maps.values():
        ancestors = [m["name"]]
        parent = m["parentId"]
        seen = {m["id"]}
        while parent and parent not in seen:
            seen.add(parent)
            ancestors.insert(0, maps[parent]["name"])
            parent = maps[parent]["parentId"]
        m["path"] = ancestors
        m["yearContext"] = 2000 + int(m["name"]) if m["parentId"] == 2 and re.fullmatch(r"\d{2}", m["name"]) else int(m["name"]) if m["parentId"] == 2 and re.fullmatch(r"20\d{2}", m["name"]) else None
    save(out / "maps.json", list(maps.values()))

    assets = []
    asset_lookup = collections.defaultdict(list)
    for row in inventory:
        p = game / row["path"]
        if p.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        with Image.open(p) as im:
            asset = {**row, "kind": KINDS.get(p.parent.name, "environment"), "width": im.width, "height": im.height,
                     "format": im.format, "pixelSha256": pixel_hash(im), "references": []}
        asset["file"] = f"assets/{row['sha256']}{p.suffix.lower()}"
        target = out / asset["file"]
        target.parent.mkdir(exist_ok=True)
        if not target.exists() or sha(target) != row["sha256"]:
            shutil.copy2(p, target)
        assets.append(asset)
        asset_lookup[(p.parent.name.casefold(), p.stem.casefold())].append(asset)

    unresolved = []
    def reference(folder, name, origin, **details):
        if not name:
            return None
        options = asset_lookup.get((folder.casefold(), name.casefold()), [])
        ref = {"folder": folder, "name": name, **details, "assetPaths": [a["path"] for a in options]}
        if len(options) != 1:
            unresolved.append({**origin, **ref, "reason": "missing_or_ambiguous_local_file"})
        for a in options:
            a["references"].append({**origin, **details})
        return ref

    pages, code_counts, corpus = [], collections.Counter(), []
    for p in inputs:
        if p.suffix.lower() != ".lmu":
            continue
        mid = int(p.stem[3:])
        for e in ET.parse(xml_dir / p.with_suffix(".emu").name).findall(".//Event"):
            for page in e.findall("pages/EventPage"):
                eid, pid = int(e.get("id")), int(page.get("id"))
                origin = {"mapId": mid, "eventId": eid, "pageId": pid}
                locator = f"Map{mid:04}/E{eid:04}/P{pid:04}"
                cs = commands(page)
                code_counts.update(c["code"] for c in cs)
                first = next((c for c in cs if c["code"] == 10110), None)
                title = first["string"] if first else ""
                matched, method = match(title) if title else ([], "no_text")
                sprite = reference("CharSet", value(page, "character_name"), origin,
                                   role="event_sprite", index=number(page, "character_index"))
                refs, messages, branch, initial_face, face = [], [], {}, None, None
                for c in cs:
                    code, s, params, idx = c["code"], c["string"], c["parameters"], c["index"]
                    if code == 10140:
                        # A choice branch may change faces; keep each branch's starting state.
                        branch[c["indent"]] = {"label": None, "startFace": face}
                    elif code == 20140:
                        state = branch.setdefault(c["indent"], {"startFace": None})
                        state["label"] = s
                        face = state["startFace"]
                    elif code == 20141:
                        branch.pop(c["indent"], None)
                        face = None  # Runtime choice is unknown; do not infer a merged face state.
                    elif code == 10130:
                        face = reference("FaceSet", s, {**origin, "commandIndex": idx}, role="message_face", index=params[0] if params else 0)
                        if face:
                            refs.append({**face, "commandIndex": idx})
                        if first and idx < first["index"]:
                            initial_face = face
                    elif code == 11110:
                        ref = reference("Picture", s, {**origin, "commandIndex": idx}, role="show_picture", parameters=params)
                        if ref:
                            refs.append({**ref, "commandIndex": idx})
                    elif code == 10110:
                        messages.append({"commandIndex": idx, "lines": [s], "sections": [v["label"] for _, v in sorted(branch.items()) if v.get("label")], "face": face})
                    elif code == 20110 and messages:
                        messages[-1]["lines"].append(s)
                body = "\n".join("\n".join(m["lines"]) for m in messages)
                record = {**origin, "locator": locator, "eventName": value(e, "name"), "x": number(e, "x"), "y": number(e, "y"),
                          "mapPath": maps[mid]["path"], "yearContext": maps[mid]["yearContext"],
                          "title": title, "matchStatus": method, "candidateCharacterIds": matched,
                          "candidateOriginalNames": [by_id[i]["original_name"] for i in matched],
                          "sprite": sprite, "initialFace": initial_face, "imageReferences": refs,
                          "messages": messages, "commands": cs, "conditionXml": ET.tostring(page.find("condition"), encoding="unicode"),
                          "bodySha256": hashlib.sha256(body.encode()).hexdigest(),
                          "yearMentions": sorted(set(re.findall(r"(?:19|20)\d{2}年(?:\d{1,2}月(?:\d{1,2}日)?)?", body))),
                          "workSections": [m for m in messages if any("作品" in s for s in m["sections"])]}
                pages.append(record)
                if messages:
                    corpus.append(f"## {locator} | {' / '.join(maps[mid]['path'])} | {title}\n")
                    for m in messages:
                        corpus.append(f"[{m['commandIndex']}] {' / '.join(m['sections'])}\n" + "\n".join(m["lines"]) + "\n")
    save(out / "events.json", pages)
    (out / "dialogue.txt").write_text("\n".join(corpus), encoding="utf-8")
    database = ET.parse(xml_dir / "RPG_RT.edb")
    actors = [{"id": int(a.get("id")), **{field: value(a, field) for field in ["name", "title", "character_name", "character_index", "face_name", "face_index"]}}
              for a in database.findall(".//Actor")]
    common_events = [{"id": int(e.get("id")), "name": value(e, "name"), "commands": commands(e)} for e in database.findall(".//CommonEvent")]
    save(out / "database.json", {"actors": actors, "commonEvents": common_events,
         "note": "Database actors may be editor defaults; they are not automatically character entries."})
    for event in common_events:
        if event["commands"]:
            corpus.append(f"## RPG_RT/CommonEvent{event['id']:04} | {event['name']}\n")
            corpus.extend(f"[{c['index']}] {c['string']}\n" for c in event["commands"] if c["string"])
    (out / "dialogue.txt").write_text("\n".join(corpus), encoding="utf-8")
    save(out / "unresolved-image-references.json", unresolved)
    print(f"Extracted {len(pages)} event pages and {len(assets)} image files", flush=True)

    existing_bytes, existing_pixels = collections.defaultdict(list), collections.defaultdict(list)
    manifest_counts = {}
    manifest_hashes = {}
    decode_errors = []
    for directory, field in [("character-face-sheets", "sheets"), ("character-materials", "materials")]:
        base = ROOT / "data" / directory
        manifest = base / "manifest.json"
        manifest_hashes[directory] = sha(manifest)
        items = json.loads(manifest.read_text(encoding="utf-8"))[field]
        manifest_counts[directory] = len(items)
        for item_index, item in enumerate(items):
            path = base / item["file"]
            if sha(path) != item["sha256"]:
                raise ValueError(f"Repository asset hash mismatch: {path}")
            info = {"kind": item.get("kind", "faceset"), "file": path.relative_to(ROOT).as_posix(), "sha256": item["sha256"], "names": item["boundOriginalNames"]}
            existing_bytes[item["sha256"]].append(info)
            try:
                with Image.open(path) as im:
                    existing_pixels[pixel_hash(im)].append(info)
            except (OSError, ValueError) as error:
                decode_errors.append({"file": info["file"], "error": str(error), "byteComparisonAvailable": True})
            if (item_index + 1) % 2000 == 0:
                print(f"Compared {directory}: {item_index + 1}/{len(items)}", flush=True)
    for a in assets:
        a["existingByteMatches"] = existing_bytes.get(a["sha256"], [])
        a["existingPixelMatches"] = existing_pixels.get(a["pixelSha256"], [])
        a["novelty"] = "same_bytes" if a["existingByteMatches"] else "same_decoded_rgba" if a["existingPixelMatches"] else "not_found_as_whole_image"
    save(out / "assets.json", assets)
    save(out / "repository-image-decode-errors.json", decode_errors)
    asset_by_path = {a["path"]: a for a in assets}
    candidates = []
    for page in pages:
        if not page["title"]:
            continue
        direct_refs = [r for r in [page["sprite"], page["initialFace"]] if r]
        paths = sorted({p for r in direct_refs for p in r["assetPaths"]})
        candidates.append({"locator": page["locator"], "title": page["title"], "mapPath": page["mapPath"], "yearContext": page["yearContext"],
                           "matchStatus": page["matchStatus"], "candidateCharacterIds": page["candidateCharacterIds"],
                           "candidateOriginalNames": page["candidateOriginalNames"], "messageCount": len(page["messages"]),
                           "directImagePaths": paths, "newWholeImagePaths": [p for p in paths if asset_by_path[p]["novelty"] == "not_found_as_whole_image"],
                           "yearMentions": page["yearMentions"], "workSectionMessages": len(page["workSections"]),
                           "reviewRequired": True})
    save(out / "candidates.json", candidates)
    csv_file(out / "candidates.csv", candidates, list(candidates[0]) if candidates else [])
    csv_file(out / "assets.csv", assets, ["path", "kind", "width", "height", "sha256", "novelty", "existingByteMatches", "existingPixelMatches"])
    text_pages = [p for p in pages if p["messages"]]
    exact = [p for p in text_pages if p["matchStatus"] == "exact_name_or_alias"]
    matched_ids = sorted({i for p in exact for i in p["candidateCharacterIds"]})
    profiles = []
    for cid in matched_ids:
        bodies = collections.defaultdict(list)
        for page in exact:
            if cid in page["candidateCharacterIds"]:
                bodies[page["bodySha256"]].append(page)
        profiles.append({"characterId": cid, "originalName": by_id[cid]["original_name"],
            "primaryName": by_id[cid]["primary_name"], "currentDescription": by_id[cid]["description"],
            "reviewRequired": True, "texts": [{"locators": [p["locator"] for p in group],
                "mapPaths": [p["mapPath"] for p in group], "messages": group[0]["messages"]}
                for group in bodies.values()]})
    save(out / "character-evidence.json", profiles)
    by_kind = {}
    for kind in sorted({a["kind"] for a in assets}):
        subset = [a for a in assets if a["kind"] == kind]
        by_kind[kind] = {"files": len(subset), "referencedInMapEvents": sum(bool(a["references"]) for a in subset), **dict(collections.Counter(a["novelty"] for a in subset))}
    summary = {"generatedAt": datetime.now(timezone.utc).isoformat(), "game": str(game), "database": str(db_path),
               "sourceLcfFiles": len(inputs), "maps": len(inputs) - 2, "eventPages": len(pages), "textEventPages": len(text_pages),
               "messageBlocks": sum(len(p["messages"]) for p in pages), "messageLines": sum(len(m["lines"]) for p in pages for m in p["messages"]),
               "uniqueTextBodies": len({p["bodySha256"] for p in text_pages}), "uniqueHeadings": len({p["title"] for p in text_pages}),
               "currentCharacters": len(current["characters"]), "exactMatchedCharacters": len(matched_ids),
               "exactMatchedCharactersWithoutDescription": sum(not by_id[i]["description"] for i in matched_ids),
               "matchStatusByEventPage": dict(collections.Counter(p["matchStatus"] for p in text_pages)),
               "imageFiles": len(assets), "imageUniqueBytes": len({a["sha256"] for a in assets}), "imagesByKind": by_kind,
               "unresolvedImageReferences": len(unresolved), "commandCounts": dict(sorted(code_counts.items())),
               "repositoryImageDecodeErrors": len(decode_errors),
               "commonEventMessageLines": sum(c["code"] in {10110, 20110} for e in common_events for c in e["commands"]),
               "repositoryManifestCounts": manifest_counts, "repositoryManifestSha256": manifest_hashes,
               "limitations": ["Static extraction, all choice branches; no gameplay execution.",
                               "Name matches are review candidates, not proof of identity; headings may describe groups or variants.",
                               "Whole-file/decoded-RGBA comparisons do not establish new artwork: packed sheets, crops and palettes can differ.",
                               "Initial face and event sprite are evidence only; later faces/pictures may depict other characters.",
                               "yearContext is a map classification, not a verified creation year; yearMentions include work dates.",
                               "Game accounts may describe conventions, individual works, author opinions or uncertainty."]}
    save(out / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
