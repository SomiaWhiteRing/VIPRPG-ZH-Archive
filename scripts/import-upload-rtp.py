"""Generate RTP metadata only using RPGRewriter's filename and pack rules.

python scripts/import-upload-rtp.py --rewriter ../RPGRewriter-Ownuse
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
import zlib

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rewriter", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.rewriter.resolve()))
    from core.external.rtp import _decode_raw_zip_name, _normalize_member_path
    from core.external.rtp_collection import RtpCollection

    source = args.rewriter / "modules/RTPCollection/rtp-content.zip"
    rows = {}
    blobs = set()
    with RtpCollection(source) as collection:
        for pack in collection.packs:
            for entry, raw_name in collection.entries(pack):
                if entry["directory"]:
                    continue
                name, _, _ = _decode_raw_zip_name(raw_name, f"{pack}.zip")
                relative, _ = _normalize_member_path(name)
                name = unicodedata.normalize("NFC", Path(relative).as_posix())
                data = collection.read(entry)
                digest = entry["sha256"]
                blobs.add(digest)
                rows.setdefault((name, len(data), digest, zlib.crc32(data)), []).append(pack)
    catalog = {
        "source": "RPGRewriter-Ownuse/modules/RTPCollection/rtp-content.zip",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "entries": [[name, size, digest, packs, crc] for (name, size, digest, crc), packs in sorted(rows.items())],
    }
    (ROOT / "lib/archive/rtp-upload-catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated metadata for {len(rows)} RTP paths and {len(blobs)} verified blobs; no assets copied")


if __name__ == "__main__":
    main()
