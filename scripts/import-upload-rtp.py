"""Generate RTP metadata using RPGRewriter names and EasyRPG's known aliases.

python scripts/import-upload-rtp.py --rewriter ../RPGRewriter-Ownuse --player ../Player
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import zlib

ROOT = Path(__file__).resolve().parents[1]
# Match each pack only against its own naming columns. The 2000 English pack
# combines official and Don Miguel names; 2003steam uses RPG Advocate names.
# 2000fix contains garbled literal names and has no matching table column.
PACK_ALIAS_COLUMNS = {
    "2000": {"2000": (1,), "2000en": (2, 3)},
    "2003": {"2003": (1,), "2003steam": (3,), "2003zh_tw": (7,)},
}


def normalize(path):
    return unicodedata.normalize("NFC", path).lower()


def rtp_aliases(player, entries):
    table_bytes = (player / "src/rtp_table.cpp").read_bytes()
    table = table_bytes.decode("utf-8")
    by_name = {}
    exact_paths = {normalize(row[0]) for row in entries}
    for index, (path, _size, _digest, packs, _crc) in enumerate(entries):
        stem = normalize(Path(path).with_suffix("").as_posix())
        for pack in packs:
            by_name.setdefault((pack, stem), set()).add(index)
    aliases = {}
    for family, table_name, columns in (("2000", "rtp_table_2k", 5), ("2003", "rtp_table_2k3", 8)):
        match = re.search(rf"const char\* const {table_name}\[\]\[{columns}\]\s*=\s*\{{(.*?)\}};", table, re.S)
        if not match:
            raise ValueError(f"Unsupported EasyRPG alias table: {table_name}")
        paths = {}
        for row in re.findall(r"\{([^{}]+)\}", match[1]):
            tokens = re.findall(r'"(?:\\.|[^"\\])*"|nullptr', row)
            if len(tokens) != columns:
                raise ValueError(f"Unsupported EasyRPG alias row: {row}")
            values = [None if token == "nullptr" else json.loads(token) for token in tokens]
            if values[0] is None:
                continue
            directory = values[0]
            names = {normalize(name) for name in values[1:] if name}
            # A translated alias can also be another resource's real filename
            # in a different language. Do not use it to select that pack's bytes.
            members = {index for pack, column_ids in PACK_ALIAS_COLUMNS[family].items()
                       for column in column_ids if values[column]
                       for index in by_name.get((pack, normalize(f"{directory}/{values[column]}")), ())}
            for name in names:
                for index in sorted(members):
                    path, _size, digest, _packs, _crc = entries[index]
                    alias = f"{directory}/{name}{Path(path).suffix.lower()}"
                    # Real filenames always win. Keep every distinct SHA for
                    # other aliases so the resolver can reject ambiguity.
                    if alias not in exact_paths:
                        paths.setdefault(alias, {}).setdefault(digest, index)
        aliases[family] = [[path, index] for path, candidates in sorted(paths.items())
                           for _digest, index in sorted(candidates.items())]
    return aliases, {
        "source": "https://github.com/EasyRPG/Player/blob/master/src/rtp_table.cpp",
        "sha256": hashlib.sha256(table_bytes).hexdigest(),
        "license": "GPL-3.0-or-later",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rewriter", type=Path, required=True)
    parser.add_argument("--player", type=Path, required=True)
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
    entries = [[name, size, digest, packs, crc] for (name, size, digest, crc), packs in sorted(rows.items())]
    aliases, alias_source = rtp_aliases(args.player, entries)
    license_bytes = (args.player / "COPYING").read_bytes()
    catalog = {
        "source": "RPGRewriter-Ownuse/modules/RTPCollection/rtp-content.zip",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "entries": entries,
        "aliasSource": alias_source,
        "aliases": aliases,
    }
    (ROOT / "lib/archive/rtp-upload-catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    license_path = ROOT / "public/licenses/easyrpg-player/COPYING"
    license_path.parent.mkdir(parents=True, exist_ok=True)
    license_path.write_bytes(license_bytes)
    print(f"Generated metadata for {len(rows)} RTP paths, {sum(map(len, aliases.values()))} alias candidates "
          f"and {len(blobs)} verified blobs; no assets copied")


if __name__ == "__main__":
    main()
