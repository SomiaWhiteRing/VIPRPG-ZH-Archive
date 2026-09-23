"""Generate metadata only; verify every RTP blob before trusting its fingerprint.

python scripts/generate-rtp-catalog.py --collection ../RPGRewriter-Ownuse/modules/RTPCollection/rtp-content.zip --liblcf ../liblcf
"""
import argparse
import base64
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACK_ENCODINGS = {
    "2000": ["gbk"], "2000en": ["cp1252"],
    "2000fix": ["cp932", "gbk"], "2003": ["gbk"],
    "2003steam": ["utf-8", "cp1252"], "2003zh_tw": ["big5"],
}
ASSET_DIRS = set("backdrop battle battle2 battlecharset battleweapon charset chipset faceset gameover monster movie music panorama picture sound system system2 title".split())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, value):
    target = ROOT / "lib/archive" / name
    target.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{target.name}: {target.stat().st_size:,} bytes")


def catalog(path):
    entries, checked, counts = {}, set(), {}
    with zipfile.ZipFile(path) as archive:
        source = json.loads(archive.read("manifest.json"))
        if source["schema"] != 1 or set(source["packs"]) != set(PACK_ENCODINGS):
            raise ValueError("Unexpected RTP collection schema/packs")
        for pack, rows in source["packs"].items():
            counts[pack] = 0
            for row in rows:
                if row["directory"]:
                    continue
                digest, size = row["sha256"], row["size"]
                if digest not in checked:
                    data = archive.read(f"blobs/{digest}")
                    if sha(data) != digest or len(data) != size:
                        raise ValueError(f"Corrupt RTP: {pack} {digest}")
                    checked.add(digest)
                elif archive.getinfo(f"blobs/{digest}").file_size != size:
                    raise ValueError("Conflicting RTP size")
                counts[pack] += 1
                raw = base64.b64decode(row["name"], validate=True)
                # The source ZIPs include DBCS trail bytes incorrectly changed to '/'.
                head, separator, tail = raw.partition(b"/")
                raw = head + separator + tail.replace(b"/", b"\\")
                for encoding in PACK_ENCODINGS[pack]:
                    try:
                        name = raw.decode(encoding)
                    except UnicodeError:
                        continue
                    parts = name.split("/")
                    if len(parts) != 2 or parts[0].lower() not in ASSET_DIRS or "\\" in name:
                        continue
                    key = (name.lower(), size, digest)
                    entries.setdefault(key, set()).add(pack)
        manifest_bytes = archive.read("manifest.json")
    rows = [[path, size, digest, sorted(packs)] for (path, size, digest), packs in sorted(entries.items())]
    write("rtp-catalog.json", {
        "schema": 1, "source": "WindyTranslator/modules/RTPCollection/rtp-content.zip",
        "sourceSha256": sha(path.read_bytes()), "sourceManifestSha256": sha(manifest_bytes),
        "packFileCounts": counts, "verifiedBlobCount": len(checked), "entries": rows,
    })
    print(f"RTP: {sum(counts.values())} source files, {len(checked)} verified blobs, {len(rows)} fingerprints")


def schema(path):
    source = path / "generator/csv"
    def rows(name):
        with (source / name).open(encoding="utf-8", newline="") as file:
            return list(csv.DictReader(file))
    structs = {r["Structure"] for r in rows("structs.csv") if r["Type"] in {"ldb", "lmu", "lmt"}}
    fields = {}
    for row in rows("fields.csv"):
        if row["Structure"] not in structs or not row["Index"]:
            continue
        kind = row["Type"]
        if row["Size Field?"] == "t":
            kind = "skip"
        elif kind in {"DBString", "String"}:
            if row["Default Value"] not in {"", '"(OFF)"'}:
                raise ValueError("Review nonempty implicit string defaults")
            kind = "string"
        elif kind == "Vector<EventCommand>":
            kind = "commands"
        elif kind == "Vector<MoveCommand>":
            kind = "moves"
        elif kind.startswith("Array<"):
            kind = "array:" + kind[6:-1].split(":")[0]
        elif kind in structs and kind not in {"Parameters", "Equipment", "Rect"}:
            kind = "struct:" + kind
        else:
            kind = "skip"
        fields.setdefault(row["Structure"], {})[str(int(row["Index"], 16))] = kind
    codes = {r["Index"]: r["Value"] for r in rows("enums.csv") if r["Structure"] == "EventCommand" and r["Entry"] == "Code"}
    write("lcf-scan-schema.json", {
        "source": "https://github.com/EasyRPG/liblcf", "license": "MIT",
        "revision": subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip(),
        "fieldsSha256": sha((source / "fields.csv").read_bytes()),
        "enumsSha256": sha((source / "enums.csv").read_bytes()),
        "structs": fields, "commands": codes,
    })
    license_path = ROOT / "public/licenses/liblcf/COPYING"
    license_path.parent.mkdir(parents=True, exist_ok=True)
    license_path.write_bytes((path / "COPYING").read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--liblcf", type=Path, required=True)
    args = parser.parse_args()
    catalog(args.collection)
    schema(args.liblcf)
